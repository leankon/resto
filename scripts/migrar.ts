/**
 * Aplica las migraciones pendientes. Corre antes del build.
 *
 * El problema que resuelve: cada cambio de esquema obligaba a entrar al panel del
 * proveedor y pegar SQL a mano, y olvidarse no daba un error claro sino una pantalla
 * de "Application error" en la página que usaba la columna nueva.
 *
 * Necesita DATABASE_URL_OWNER, que es la conexión del dueño de la base: crear tablas
 * y cambiar columnas requiere ser dueño, y los tres roles de la aplicación no lo son
 * a propósito. Si esa variable no está, no hace nada y avisa: así un build local o de
 * prueba no falla por no tener credenciales de migración.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = process.env['DATABASE_URL_OWNER'];
if (!url) {
  console.log('migraciones: DATABASE_URL_OWNER no está definida, no se aplica nada.');
  process.exit(0);
}

const carpeta = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'datos', 'migraciones');
const archivos = readdirSync(carpeta).filter((f) => f.endsWith('.sql')).sort();

const esLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const cliente = new pg.Client({
  connectionString: url,
  ...(esLocal ? {} : { ssl: { rejectUnauthorized: false } }),
});

await cliente.connect();
try {
  await cliente.query(`
    CREATE TABLE IF NOT EXISTS migraciones_aplicadas (
      archivo     text PRIMARY KEY,
      aplicada_en timestamptz NOT NULL DEFAULT now())`);

  const { rows } = await cliente.query('SELECT archivo FROM migraciones_aplicadas');
  const yaEstan = new Set(rows.map((f) => f.archivo as string));

  let aplicadas = 0;
  for (const archivo of archivos) {
    if (yaEstan.has(archivo)) continue;
    console.log(`migraciones: aplicando ${archivo}`);
    // Cada migración en su propia transacción: si una falla, no deja media aplicada
    // y el build se corta antes de publicar código que la necesita.
    await cliente.query('BEGIN');
    try {
      await cliente.query(readFileSync(join(carpeta, archivo), 'utf8'));
      await cliente.query('INSERT INTO migraciones_aplicadas (archivo) VALUES ($1)', [archivo]);
      await cliente.query('COMMIT');
      aplicadas++;
    } catch (error) {
      await cliente.query('ROLLBACK');
      console.error(`migraciones: falló ${archivo}`);
      throw error;
    }
  }
  console.log(
    aplicadas === 0
      ? `migraciones: al día (${archivos.length} aplicadas).`
      : `migraciones: ${aplicadas} nueva${aplicadas > 1 ? 's' : ''} aplicada${aplicadas > 1 ? 's' : ''}.`,
  );
} finally {
  await cliente.end();
}
