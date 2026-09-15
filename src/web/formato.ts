/** Formateo en la zona horaria del local, no en la del navegador ni la del servidor. */

// Las funciones de calendario (hoyEn, sumarDias, instanteLocal) viven en
// dominio/tiempo.ts: son puras y el motor de disponibilidad las necesita.
export { hoyEn, instanteLocal, sumarDias } from '../dominio/tiempo';

export function hora(fecha: Date, tz: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(fecha);
}

export function fechaCorta(fecha: Date, tz: string): string {
  const texto = new Intl.DateTimeFormat('es-AR', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long',
  }).format(fecha);
  // Solo la primera letra: el CSS `capitalize` deja "Lunes, 14 De Septiembre".
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export const ESTADOS: Record<string, string> = {
  confirmada: 'Confirmada',
  sentada: 'En mesa',
  finalizada: 'Terminó',
  cancelada: 'Cancelada',
  no_show: 'No vino',
  hold: 'Reservada un rato',
  en_riesgo: 'Sin confirmar',
};

export const CANALES: Record<string, string> = {
  web: 'Web',
  widget: 'Widget',
  whatsapp: 'WhatsApp',
  manual: 'Mostrador',
  walk_in: 'Sin reserva',
};
