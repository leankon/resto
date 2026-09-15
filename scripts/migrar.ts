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
  // En un despliegue de verdad, seguir sin migrar publica código que usa columnas que
  // todavía no existen. El síntoma es una pantalla de "Application error" que aparece
  // cuando alguien entra, no cuando se despliega, y cuesta muchísimo más rastrear.
  // Mejor que se caiga acá, con el motivo y el remedio escritos.
  if (process.env['VERCEL'] || process.env['CI']) {
    console.error(
      'migraciones: falta DATABASE_URL_OWNER.\n' +
        '  Es la conexión del dueño de la base (en Neon, el usuario que termina en\n' +
        '  "_owner"), y sin ella no se pueden aplicar los cambios de esquema.\n' +
        '  Agregala en Settings → Environment Variables y volvé a desplegar.',
    );
    process.exit(1);
  }
  console.log('migraciones: DATABASE_URL_OWNER no está definida, no se aplica nada.');
  process.exit(0);
}

const carpeta = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'datos', 'migraciones');
const archivos = readdirSync(carpeta).filter((f) => f.endsWith('.sql')).sort();

/**
 * Revisa que la variable tenga forma de cadena de conexión antes de intentar conectarse.
 *
 * Sin esto, pegar cualquier otra cosa en la variable da un error de DNS —
 * `getaddrinfo ENOTFOUND base`— que no dice nada sobre lo que en realidad pasó: que el
 * valor no es una conexión a Postgres. El nombre del servidor se muestra porque es lo
 * que delata el error de copiado, y la contraseña nunca se imprime.
 */
function revisarLaUrl(valor: string): URL {
  // Se corta con un mensaje y nada más: un stack trace de Node arriba del texto lo
  // esconde justo cuando alguien está buscando qué hacer.
  const cortar = (mensaje: string): never => {
    console.error(`migraciones: ${mensaje}`);
    process.exit(1);
  };

  let partes: URL;
  try {
    partes = new URL(valor);
  } catch {
    return cortar(
      'DATABASE_URL_OWNER no tiene forma de cadena de conexión.\n' +
        '  Tiene que empezar con "postgresql://" y ser el texto completo, sin comillas,\n' +
        '  sin saltos de línea y sin el nombre de la variable adelante.',
    );
  }

  if (!/^postgres(ql)?:$/.test(partes.protocol)) {
    return cortar(
      `DATABASE_URL_OWNER empieza con "${partes.protocol}//" y tiene que empezar con "postgresql://".`,
    );
  }
  // Un host de Postgres real siempre tiene puntos (o es localhost). Una sola palabra
  // suelta es texto que se coló en el copiado.
  if (!partes.hostname.includes('.') && !/^(localhost|127\.0\.0\.1)$/.test(partes.hostname)) {
    return cortar(
      `DATABASE_URL_OWNER apunta a un servidor llamado "${partes.hostname}", que no existe.\n` +
        '  Parece que quedó texto pegado en vez de la conexión. Copiala entera desde\n' +
        '  Neon (Connect → rol que termina en "_owner") y volvé a cargarla en Vercel.',
    );
  }
  return partes;
}

const partes = revisarLaUrl(url);
const esLocal = /^(localhost|127\.0\.0\.1)$/.test(partes.hostname);
const cliente = new pg.Client({
  connectionString: url,
  ...(esLocal ? {} : { ssl: { rejectUnauthorized: false } }),
});

try {
  await cliente.connect();
} catch (error) {
  // El host y el usuario ayudan a ver el error de copiado de un vistazo; la contraseña
  // no se imprime nunca, porque los logs de build los lee cualquiera del equipo.
  console.error(
    `migraciones: no se pudo conectar a ${partes.hostname} como "${partes.username}" ` +
      `a la base "${partes.pathname.slice(1)}".`,
  );
  throw error;
}
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
