import pg from 'pg';

/**
 * La app se conecta como `resto_app`, NUNCA como superusuario: el superusuario
 * ignora las políticas de RLS y el aislamiento entre locales deja de existir
 * sin que nadie se entere.
 */
export const URL_APP =
  process.env['DATABASE_URL'] ?? 'postgres://resto_app:dev@localhost:5433/resto';

/** Solo para migraciones y para el panel de super-admin. */
export const URL_ADMIN =
  process.env['DATABASE_URL_ADMIN'] ?? 'postgres://postgres@localhost:5433/resto';

export function pool(url = URL_APP): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 8 });
}

/**
 * Corre una operación de negocio dentro de una transacción con el tenant fijado.
 *
 * `SET LOCAL` obliga a que todo pase por una transacción, que es justo lo que
 * queremos: es imposible tocar datos de negocio sin declarar de qué local son.
 */
export async function conTenant<T>(
  pool: pg.Pool,
  tenantId: string,
  fn: (cliente: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}

/**
 * Serializa las asignaciones de un mismo local y un mismo día.
 *
 * Con el volumen real (200 reservas/día) la contención es cero, y a cambio el
 * motor siempre ve un estado estable: no hace falta un loop de reintentos en el
 * camino feliz. La constraint EXCLUDE queda como red de seguridad para lo que
 * entre sin pasar por acá.
 */
export async function lockDelDia(
  cliente: pg.PoolClient,
  tenantId: string,
  fecha: string,
): Promise<void> {
  await cliente.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tenantId}:${fecha}`]);
}

/** Postgres devuelve 23P01 cuando una constraint EXCLUDE rechaza la escritura. */
export const CODIGO_SOLAPE = '23P01';

export function esSolape(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === CODIGO_SOLAPE
  );
}
