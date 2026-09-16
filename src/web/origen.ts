import { headers } from 'next/headers';

/**
 * La dirección pública de este servidor, tal como la ve quien entra.
 *
 * Sale de la request y no de una variable de entorno: el mismo código corre en
 * localhost, en la URL de prueba de Vercel y en el dominio propio del día que lo haya, y
 * el link canónico tiene que ser el correcto en los tres casos. Un canónico equivocado
 * es peor que no tenerlo: le dice a Google que la página buena es otra.
 */
export async function origen(): Promise<string> {
  const cabeceras = await headers();
  const host = cabeceras.get('x-forwarded-host') ?? cabeceras.get('host') ?? 'localhost:3000';
  const protocolo =
    cabeceras.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${protocolo}://${host}`;
}
