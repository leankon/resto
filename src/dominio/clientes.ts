import { parsePhoneNumberFromString } from 'libphonenumber-js';

export interface Contacto {
  /** Formato canónico: es el que se usa para llamar o mandar WhatsApp. */
  e164: string;
  /**
   * Clave de deduplicación. Dos formas de escribir el mismo celular argentino
   * comparten esta clave aunque su E.164 difiera.
   */
  clave: string;
}

/**
 * Normaliza un teléfono tipeado de cualquier manera.
 *
 * El problema argentino: `011 15 2345-6789` normaliza a `+5491123456789` (con el 9 de
 * celular) pero `1123456789` normaliza a `+541123456789`, y son la misma persona.
 * Nadie tipea su número igual dos veces, así que si la identidad del cliente dependiera
 * del E.164, el mismo comensal aparecería como dos clientes distintos y el historial
 * quedaría partido.
 *
 * Por eso guardamos dos cosas: el E.164 canónico para contactarlo, y una clave sin el
 * prefijo de celular para reconocerlo. La clave es la que lleva el índice único.
 */
export function normalizarTelefono(crudo: string | null | undefined, pais: string): Contacto | null {
  if (!crudo || !crudo.trim()) return null;

  const numero = parsePhoneNumberFromString(crudo, pais.toUpperCase() as never);
  if (!numero || !numero.isValid()) return null;

  const e164 = numero.number;
  const nacional = numero.nationalNumber;

  // Argentina marca los celulares con un 9 después del código de país. Sacarlo
  // hace colisionar las dos formas de escribir el mismo número.
  const clave =
    numero.country === 'AR' && nacional.startsWith('9')
      ? `+${numero.countryCallingCode}${nacional.slice(1)}`
      : e164;

  return { e164, clave };
}

export function normalizarEmail(crudo: string | null | undefined): string | null {
  const limpio = crudo?.trim().toLowerCase();
  if (!limpio) return null;
  // Validación deliberadamente laxa: el mail se verifica mandando el mail, no con
  // una expresión regular que siempre rechaza alguna dirección legítima.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio) ? limpio : null;
}

export interface DatosContacto {
  nombre: string;
  telefono?: string | null;
  email?: string | null;
}

export type IdentidadCliente =
  | { tipo: 'telefono'; clave: string; e164: string; email: string | null; nombre: string }
  | { tipo: 'email'; email: string; nombre: string }
  | { tipo: 'sin_contacto' };

/**
 * Con qué dato se identifica a este cliente dentro del local.
 *
 * El teléfono manda; el mail es el identificador alternativo si no dejó teléfono.
 * Sin ninguno de los dos no hay perfil que buscar ni forma de avisarle nada, y eso
 * tiene que ser visible en el panel, no un error silencioso.
 */
export function identificar(datos: DatosContacto, pais: string): IdentidadCliente {
  const telefono = normalizarTelefono(datos.telefono, pais);
  const email = normalizarEmail(datos.email);
  const nombre = datos.nombre.trim();

  if (telefono) return { tipo: 'telefono', clave: telefono.clave, e164: telefono.e164, email, nombre };
  if (email) return { tipo: 'email', email, nombre };
  return { tipo: 'sin_contacto' };
}

/**
 * Teléfono como lo lee una persona. En la base se guarda siempre en E.164; esto es
 * solo para mostrarlo, porque `+5491188887777` no se puede dictar por teléfono.
 */
export function telefonoLegible(e164: string | null | undefined): string {
  if (!e164) return '';
  const numero = parsePhoneNumberFromString(e164);
  return numero?.formatInternational() ?? e164;
}
