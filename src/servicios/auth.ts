import type pg from 'pg';
import { generarToken, hashearPassword, hashearToken, verificarPassword } from '../dominio/passwords.js';

/** Un turno largo. Al staff no le sirve que la sesión se corte en medio del servicio. */
const HORAS_DE_SESION = 12;

/**
 * Hash descartable con el que comparar cuando el mail no existe.
 *
 * Sin esto, un login con mail inexistente responde mucho más rápido que uno con mail
 * válido y contraseña incorrecta, y esa diferencia de tiempo sirve para averiguar qué
 * direcciones están registradas.
 */
const HASH_FANTASMA = hashearPassword('contraseña que nadie va a usar jamás');

export interface LocalDelUsuario {
  tenantId: string;
  nombre: string;
  slug: string;
  rol: string;
}

export type ResultadoLogin =
  | { tipo: 'ok'; token: string; expiraEn: Date; locales: LocalDelUsuario[]; tenantId: string | null }
  | { tipo: 'credenciales_invalidas' }
  | { tipo: 'sin_locales' };

/**
 * Login de staff. Devuelve un token de sesión y los locales a los que la persona
 * tiene acceso; si es uno solo, queda activo directamente.
 */
export async function login(
  auth: pg.Pool,
  entrada: { email: string; password: string },
): Promise<ResultadoLogin> {
  const email = entrada.email.trim().toLowerCase();
  const { rows } = await auth.query(
    `SELECT id, hash, activo FROM usuarios WHERE lower(email) = $1`,
    [email],
  );
  const usuario = rows[0];

  const valida = await verificarPassword(
    entrada.password,
    usuario?.hash ?? (await HASH_FANTASMA),
  );
  if (!usuario || !usuario.activo || !valida) return { tipo: 'credenciales_invalidas' };

  const locales = await auth.query(
    `SELECT t.id, t.nombre, t.slug, ut.rol
       FROM usuarios_tenants ut JOIN tenants t ON t.id = ut.tenant_id
      WHERE ut.usuario_id = $1 AND t.estado = 'activo'
      ORDER BY t.nombre`,
    [usuario.id],
  );
  if (locales.rows.length === 0) return { tipo: 'sin_locales' };

  const tenantId = locales.rows.length === 1 ? (locales.rows[0].id as string) : null;
  const { token, expiraEn } = await abrirSesion(auth, { usuarioId: usuario.id, tenantId });

  return {
    tipo: 'ok',
    token,
    expiraEn,
    tenantId,
    locales: locales.rows.map((f) => ({
      tenantId: f.id,
      nombre: f.nombre,
      slug: f.slug,
      rol: f.rol,
    })),
  };
}

export async function loginAdmin(
  auth: pg.Pool,
  entrada: { email: string; password: string },
): Promise<{ tipo: 'ok'; token: string; expiraEn: Date } | { tipo: 'credenciales_invalidas' }> {
  const { rows } = await auth.query(
    `SELECT id, hash FROM admins_plataforma WHERE lower(email) = $1`,
    [entrada.email.trim().toLowerCase()],
  );
  const admin = rows[0];
  const valida = await verificarPassword(entrada.password, admin?.hash ?? (await HASH_FANTASMA));
  if (!admin || !valida) return { tipo: 'credenciales_invalidas' };

  const { token, expiraEn } = await abrirSesion(auth, { adminId: admin.id });
  return { tipo: 'ok', token, expiraEn };
}

export type Sesion =
  | { tipo: 'staff'; usuarioId: string; nombre: string; tenantId: string | null; rol: string | null }
  | { tipo: 'admin'; adminId: string; nombre: string };

/**
 * Resuelve el token de una request. Devuelve null si no existe o venció.
 *
 * La expiración se chequea en la consulta, no en JavaScript: una sesión vencida no
 * puede revivir porque el reloj del servidor de aplicación esté corrido.
 */
export async function sesionActual(auth: pg.Pool, token: string | undefined): Promise<Sesion | null> {
  if (!token) return null;
  const { rows } = await auth.query(
    `SELECT s.usuario_id, s.admin_id, s.tenant_id,
            u.nombre AS nombre_usuario, a.nombre AS nombre_admin, ut.rol
       FROM sesiones s
       LEFT JOIN usuarios u ON u.id = s.usuario_id AND u.activo
       LEFT JOIN admins_plataforma a ON a.id = s.admin_id
       LEFT JOIN usuarios_tenants ut
              ON ut.usuario_id = s.usuario_id AND ut.tenant_id = s.tenant_id
      WHERE s.token_hash = $1 AND s.expira_en > now()`,
    [hashearToken(token)],
  );
  const f = rows[0];
  if (!f) return null;

  if (f.admin_id) return { tipo: 'admin', adminId: f.admin_id, nombre: f.nombre_admin };
  if (!f.nombre_usuario) return null; // usuario desactivado desde que abrió la sesión
  return {
    tipo: 'staff',
    usuarioId: f.usuario_id,
    nombre: f.nombre_usuario,
    tenantId: f.tenant_id,
    rol: f.rol ?? null,
  };
}

/** Cambia el local activo, verificando que la persona trabaje ahí. */
export async function elegirLocal(
  auth: pg.Pool,
  token: string,
  tenantId: string,
): Promise<boolean> {
  const { rowCount } = await auth.query(
    `UPDATE sesiones SET tenant_id = $2
      WHERE token_hash = $1 AND expira_en > now()
        AND EXISTS (SELECT 1 FROM usuarios_tenants
                     WHERE usuario_id = sesiones.usuario_id AND tenant_id = $2)`,
    [hashearToken(token), tenantId],
  );
  return rowCount === 1;
}

export async function cerrarSesion(auth: pg.Pool, token: string): Promise<void> {
  await auth.query(`DELETE FROM sesiones WHERE token_hash = $1`, [hashearToken(token)]);
}

/** Las sesiones vencidas no se borran solas; esto lo corre un job. */
export async function limpiarSesionesVencidas(auth: pg.Pool): Promise<number> {
  const { rowCount } = await auth.query(`DELETE FROM sesiones WHERE expira_en < now()`);
  return rowCount ?? 0;
}

async function abrirSesion(
  auth: pg.Pool,
  quien: { usuarioId?: string; adminId?: string; tenantId?: string | null },
): Promise<{ token: string; expiraEn: Date }> {
  const token = generarToken();
  const expiraEn = new Date(Date.now() + HORAS_DE_SESION * 3600_000);
  await auth.query(
    `INSERT INTO sesiones (token_hash, usuario_id, admin_id, tenant_id, expira_en)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      hashearToken(token),
      quien.usuarioId ?? null,
      quien.adminId ?? null,
      quien.tenantId ?? null,
      expiraEn,
    ],
  );
  return { token, expiraEn };
}
