import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// promisify no elige el overload con opciones, así que se tipa a mano.
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  sal: string | Buffer,
  largo: number,
  opciones: ScryptOptions,
) => Promise<Buffer>;

/**
 * Parámetros de scrypt. N=2^16 tarda del orden de 100 ms por hash en hardware
 * corriente: suficiente para que probar contraseñas a lo bruto no sea práctico,
 * y poco como para no molestar en un login.
 */
const N = 65536;
const r = 8;
const p = 1;
const LARGO = 32;

/**
 * scrypt necesita 128 · N · r bytes. Node topea en 32 MB por defecto y con estos
 * parámetros hacen falta 64, así que hay que pedirlo explícitamente o falla en
 * runtime con "memory limit exceeded".
 */
const maxmem = (n: number, rr: number) => 128 * n * rr * 2;

/**
 * scrypt viene en Node, así que no hace falta una dependencia nativa que compilar
 * en cada deploy. Argon2id sería la recomendación de manual, pero scrypt con estos
 * parámetros es sólido y una dependencia menos es una cosa menos que se rompe.
 */
export async function hashearPassword(password: string): Promise<string> {
  const sal = randomBytes(16);
  const derivada = await scryptAsync(password.normalize('NFKC'), sal, LARGO, {
    N, r, p, maxmem: maxmem(N, r),
  });
  return `scrypt$${N}$${r}$${p}$${sal.toString('base64')}$${derivada.toString('base64')}`;
}

/** Comparación en tiempo constante: una comparación normal filtra el hash de a un byte. */
export async function verificarPassword(password: string, guardado: string): Promise<boolean> {
  const partes = guardado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;

  const [, nTexto, rTexto, pTexto, salB64, hashB64] = partes as [
    string, string, string, string, string, string,
  ];
  const esperado = Buffer.from(hashB64, 'base64');
  if (esperado.length === 0) return false;
  const n = Number(nTexto);
  const rGuardado = Number(rTexto);
  // Los parámetros salen del hash guardado: una contraseña hasheada con parámetros
  // viejos tiene que seguir verificando después de subirlos.
  const derivada = await scryptAsync(
    password.normalize('NFKC'),
    Buffer.from(salB64, 'base64'),
    esperado.length,
    { N: n, r: rGuardado, p: Number(pTexto), maxmem: maxmem(n, rGuardado) },
  );

  return derivada.length === esperado.length && timingSafeEqual(derivada, esperado);
}

/** Token de sesión: 256 bits de aleatoriedad criptográfica, en base64url. */
export function generarToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Hash del token de sesión. SHA-256 alcanza y sobra: el token tiene 256 bits de
 * aleatoriedad, así que no hay diccionario que probar y no tiene sentido pagar el
 * costo de scrypt en cada request.
 */
export function hashearToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
