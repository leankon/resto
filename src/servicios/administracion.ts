import type pg from 'pg';
import { hashearPassword } from '../dominio/passwords.js';
import { crearLocal, type LocalCreado, type LocalNuevo } from '../datos/semilla.js';

/**
 * Operaciones del panel de super-admin.
 *
 * Todas usan la conexión de administrador, y es a propósito: dar de alta un local y
 * crear a su primer dueño son, por definición, las dos cosas que no pueden ocurrir
 * dentro del alcance de ningún tenant. El rol del login no llega acá — solo lee.
 */

export interface AltaDeLocal extends LocalNuevo {
  duenio: { email: string; nombre: string; password: string };
}

export interface ResultadoAlta extends LocalCreado {
  usuarioId: string;
}

/** Crea el local con su plano y su primer usuario dueño, en un solo paso. */
export async function altaDeLocal(admin: pg.Pool, datos: AltaDeLocal): Promise<ResultadoAlta> {
  const local = await crearLocal(admin, datos);
  const { usuarioId } = await crearUsuarioStaff(admin, {
    ...datos.duenio,
    tenantId: local.tenantId,
    rol: 'dueño',
  });
  return { ...local, usuarioId };
}

export type Rol = 'dueño' | 'encargado' | 'mozo';

/**
 * Alta de staff. El upsert por mail permite que la misma persona trabaje en dos
 * locales con una sola cuenta, en vez de tener que recordar dos contraseñas.
 */
export async function crearUsuarioStaff(
  admin: pg.Pool,
  entrada: { email: string; nombre: string; password: string; tenantId: string; rol: Rol },
): Promise<{ usuarioId: string }> {
  const hash = await hashearPassword(entrada.password);
  const { rows } = await admin.query(
    `INSERT INTO usuarios (email, nombre, hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`,
    [entrada.email.trim().toLowerCase(), entrada.nombre, hash],
  );
  const usuarioId = rows[0].id as string;
  await admin.query(
    `INSERT INTO usuarios_tenants (usuario_id, tenant_id, rol) VALUES ($1, $2, $3)
     ON CONFLICT (usuario_id, tenant_id) DO UPDATE SET rol = EXCLUDED.rol`,
    [usuarioId, entrada.tenantId, entrada.rol],
  );
  return { usuarioId };
}

export async function crearAdminPlataforma(
  admin: pg.Pool,
  entrada: { email: string; nombre: string; password: string },
): Promise<{ adminId: string }> {
  const hash = await hashearPassword(entrada.password);
  const { rows } = await admin.query(
    `INSERT INTO admins_plataforma (email, nombre, hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, hash = EXCLUDED.hash
     RETURNING id`,
    [entrada.email.trim().toLowerCase(), entrada.nombre, hash],
  );
  return { adminId: rows[0].id as string };
}

export interface ResumenLocal {
  tenantId: string;
  slug: string;
  nombre: string;
  estado: string;
  mesas: number;
  reservasProximas: number;
}

export async function listarLocales(admin: pg.Pool): Promise<ResumenLocal[]> {
  const { rows } = await admin.query(
    `SELECT t.id, t.slug, t.nombre, t.estado,
            (SELECT count(*) FROM mesas WHERE tenant_id = t.id AND activa) AS mesas,
            (SELECT count(*) FROM reservas
              WHERE tenant_id = t.id AND inicio > now()
                AND estado IN ('confirmada', 'en_riesgo')) AS proximas
       FROM tenants t ORDER BY t.nombre`,
  );
  return rows.map((f) => ({
    tenantId: f.id,
    slug: f.slug,
    nombre: f.nombre,
    estado: f.estado,
    mesas: Number(f.mesas),
    reservasProximas: Number(f.proximas),
  }));
}

export async function cambiarEstadoLocal(
  admin: pg.Pool,
  tenantId: string,
  estado: 'activo' | 'suspendido',
): Promise<void> {
  await admin.query(`UPDATE tenants SET estado = $2, actualizado_en = now() WHERE id = $1`, [
    tenantId,
    estado,
  ]);
}
