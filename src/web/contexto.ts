import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import pg from 'pg';
import { URL_ADMIN, URL_APP, URL_AUTH, pool as crearPool } from '../datos/conexion';
import { sesionActual, type Sesion } from '../servicios/auth';

/**
 * Un pool por proceso, cacheado en globalThis.
 *
 * En desarrollo Next recarga los módulos en cada cambio; sin el caché, cada recarga
 * abriría un pool nuevo y en diez minutos Postgres rechaza conexiones.
 */
const cache = globalThis as unknown as { __pools?: Record<string, pg.Pool> };
function poolCacheado(nombre: string, url: string): pg.Pool {
  cache.__pools ??= {};
  cache.__pools[nombre] ??= crearPool(url);
  return cache.__pools[nombre]!;
}

export const poolApp = () => poolCacheado('app', URL_APP);
export const poolAuth = () => poolCacheado('auth', URL_AUTH);
export const poolAdmin = () => poolCacheado('admin', URL_ADMIN);

export const COOKIE = 'resto_sesion';

export async function sesion(): Promise<Sesion | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return sesionActual(poolAuth(), token);
}

export interface ContextoStaff {
  sesion: Extract<Sesion, { tipo: 'staff' }>;
  tenantId: string;
  tenant: { nombre: string; slug: string; tz: string; pais: string };
}

/** Toda página del panel arranca por acá: sin sesión válida no se sigue. */
export async function requerirStaff(): Promise<ContextoStaff> {
  const actual = await sesion();
  if (!actual || actual.tipo !== 'staff') redirect('/login');
  if (!actual.tenantId) redirect('/elegir-local');

  const { rows } = await poolAuth().query(
    `SELECT nombre, slug, tz, pais FROM tenants WHERE id = $1 AND estado = 'activo'`,
    [actual.tenantId],
  );
  if (!rows[0]) redirect('/login');

  return { sesion: actual, tenantId: actual.tenantId, tenant: rows[0] };
}

export async function requerirAdmin(): Promise<Extract<Sesion, { tipo: 'admin' }>> {
  const actual = await sesion();
  if (!actual || actual.tipo !== 'admin') redirect('/admin/login');
  return actual;
}

export async function guardarSesion(token: string, expiraEn: Date): Promise<void> {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiraEn,
    path: '/',
  });
}

export async function borrarCookieSesion(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Actor para el log de auditoría: siempre queda quién hizo cada cosa. */
export function actorDe(ctx: ContextoStaff) {
  return { tipo: 'staff' as const, id: ctx.sesion.usuarioId };
}
