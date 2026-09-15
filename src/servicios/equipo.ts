import type pg from 'pg';
import { hashearPassword } from '../dominio/passwords';
import type { Rol } from './administracion';

/**
 * El equipo de un local: quién entra al panel y con qué permisos.
 *
 * Usa la conexión de administrador porque dar de alta a alguien implica escribir en
 * `usuarios`, y el rol de la aplicación no puede: la política de esa tabla exige que la
 * persona ya pertenezca al local, y quien recién se crea todavía no pertenece a ninguno.
 *
 * Por eso mismo, **el tenant nunca viene del navegador**: todas estas funciones lo
 * reciben de la sesión. Si se aceptara del formulario, cualquiera podría agregarse a sí
 * mismo al local de otro.
 */

export interface MiembroDelEquipo {
  usuarioId: string;
  nombre: string;
  email: string;
  rol: Rol;
  activo: boolean;
  /** true si además trabaja en otro local de la plataforma. */
  enOtrosLocales: boolean;
}

export async function listarEquipo(
  admin: pg.Pool,
  tenantId: string,
): Promise<MiembroDelEquipo[]> {
  const { rows } = await admin.query(
    `SELECT u.id, u.nombre, u.email, u.activo, ut.rol,
            EXISTS (SELECT 1 FROM usuarios_tenants o
                     WHERE o.usuario_id = u.id AND o.tenant_id <> $1) AS en_otros
       FROM usuarios_tenants ut
       JOIN usuarios u ON u.id = ut.usuario_id
      WHERE ut.tenant_id = $1
      ORDER BY CASE ut.rol WHEN 'dueño' THEN 0 WHEN 'encargado' THEN 1 ELSE 2 END, u.nombre`,
    [tenantId],
  );
  return rows.map((f) => ({
    usuarioId: f.id,
    nombre: f.nombre,
    email: f.email,
    rol: f.rol,
    activo: f.activo,
    enOtrosLocales: f.en_otros,
  }));
}

export type ResultadoEquipo =
  | { tipo: 'ok' }
  | { tipo: 'invalido'; motivo: string }
  | { tipo: 'ya_esta' }
  | { tipo: 'ultimo_duenio' }
  | { tipo: 'sos_vos' };

export async function agregarAlEquipo(
  admin: pg.Pool,
  tenantId: string,
  datos: { email: string; nombre: string; password: string; rol: Rol },
): Promise<ResultadoEquipo> {
  const email = datos.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { tipo: 'invalido', motivo: 'Ese mail no parece un mail.' };
  }
  if (!datos.nombre.trim()) return { tipo: 'invalido', motivo: 'Poné el nombre.' };
  if (datos.password.length < 10) {
    return { tipo: 'invalido', motivo: 'La contraseña tiene que tener al menos 10 caracteres.' };
  }

  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    const existente = await c.query(`SELECT id FROM usuarios WHERE lower(email) = $1`, [email]);

    let usuarioId: string;
    if (existente.rows[0]) {
      // La misma persona puede trabajar en dos locales con una sola cuenta. No se le
      // pisa la contraseña: la que usa en el otro local tiene que seguir andando.
      usuarioId = existente.rows[0].id;
      const yaEsta = await c.query(
        `SELECT 1 FROM usuarios_tenants WHERE usuario_id = $1 AND tenant_id = $2`,
        [usuarioId, tenantId],
      );
      if (yaEsta.rows[0]) {
        await c.query('ROLLBACK');
        return { tipo: 'ya_esta' };
      }
    } else {
      const creado = await c.query(
        `INSERT INTO usuarios (email, nombre, hash) VALUES ($1, $2, $3) RETURNING id`,
        [email, datos.nombre.trim(), await hashearPassword(datos.password)],
      );
      usuarioId = creado.rows[0].id;
    }

    await c.query(
      `INSERT INTO usuarios_tenants (usuario_id, tenant_id, rol) VALUES ($1, $2, $3)`,
      [usuarioId, tenantId, datos.rol],
    );
    await c.query('COMMIT');
    return { tipo: 'ok' };
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}

/** Queda al menos un dueño: sin ninguno, nadie puede volver a tocar la configuración. */
async function quedaOtroDuenio(
  c: pg.PoolClient | pg.Pool,
  tenantId: string,
  usuarioId: string,
): Promise<boolean> {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM usuarios_tenants
      WHERE tenant_id = $1 AND rol = 'dueño' AND usuario_id <> $2`,
    [tenantId, usuarioId],
  );
  return rows[0].n > 0;
}

export async function cambiarRol(
  admin: pg.Pool,
  tenantId: string,
  usuarioId: string,
  rol: Rol,
): Promise<ResultadoEquipo> {
  if (rol !== 'dueño' && !(await quedaOtroDuenio(admin, tenantId, usuarioId))) {
    const actual = await admin.query(
      `SELECT rol FROM usuarios_tenants WHERE tenant_id = $1 AND usuario_id = $2`,
      [tenantId, usuarioId],
    );
    if (actual.rows[0]?.rol === 'dueño') return { tipo: 'ultimo_duenio' };
  }
  await admin.query(
    `UPDATE usuarios_tenants SET rol = $3 WHERE tenant_id = $1 AND usuario_id = $2`,
    [tenantId, usuarioId, rol],
  );
  return { tipo: 'ok' };
}

/**
 * Saca a alguien del local. No borra su cuenta: puede estar trabajando en otro local de
 * la plataforma, y borrarla lo dejaría afuera de todos.
 */
export async function quitarDelEquipo(
  admin: pg.Pool,
  tenantId: string,
  usuarioId: string,
  quienLoHace: string,
): Promise<ResultadoEquipo> {
  if (usuarioId === quienLoHace) return { tipo: 'sos_vos' };
  if (!(await quedaOtroDuenio(admin, tenantId, usuarioId))) {
    const actual = await admin.query(
      `SELECT rol FROM usuarios_tenants WHERE tenant_id = $1 AND usuario_id = $2`,
      [tenantId, usuarioId],
    );
    if (actual.rows[0]?.rol === 'dueño') return { tipo: 'ultimo_duenio' };
  }

  await admin.query(
    `DELETE FROM usuarios_tenants WHERE tenant_id = $1 AND usuario_id = $2`,
    [tenantId, usuarioId],
  );
  // Las sesiones abiertas en ese local dejan de servir en el acto: a quien echaron hoy
  // le queda el navegador abierto en la tablet del salón.
  await admin.query(
    `DELETE FROM sesiones WHERE usuario_id = $1 AND tenant_id = $2`,
    [usuarioId, tenantId],
  );
  return { tipo: 'ok' };
}

export async function cambiarPassword(
  admin: pg.Pool,
  tenantId: string,
  usuarioId: string,
  password: string,
): Promise<ResultadoEquipo> {
  if (password.length < 10) {
    return { tipo: 'invalido', motivo: 'La contraseña tiene que tener al menos 10 caracteres.' };
  }
  // El WHERE con usuarios_tenants es lo que impide cambiarle la contraseña a alguien de
  // otro local pasando su id a mano.
  const { rowCount } = await admin.query(
    `UPDATE usuarios SET hash = $3 WHERE id = $1
      AND EXISTS (SELECT 1 FROM usuarios_tenants
                   WHERE usuario_id = $1 AND tenant_id = $2)`,
    [usuarioId, tenantId, await hashearPassword(password)],
  );
  if (rowCount === 0) return { tipo: 'invalido', motivo: 'Esa persona no trabaja en este local.' };

  await admin.query(`DELETE FROM sesiones WHERE usuario_id = $1`, [usuarioId]);
  return { tipo: 'ok' };
}
