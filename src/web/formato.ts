/** Formateo en la zona horaria del local, no en la del navegador ni la del servidor. */

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

export function hoyEn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Convierte fecha y hora local del local a un instante real.
 *
 * No se puede usar `new Date("2026-10-10T21:00")` porque interpreta la zona del
 * servidor, que en un contenedor casi siempre es UTC: la reserva de las 21:00 de un
 * bar de Buenos Aires quedaría guardada a las 18:00.
 */
export function instanteLocal(fecha: string, hora: string, tz: string): Date {
  const tentativa = new Date(`${fecha}T${hora}:00Z`);
  const comoLoVeLaZona = new Date(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
      .format(tentativa)
      .replace(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/, '$3-$1-$2T$4:$5:$6Z'),
  );
  return new Date(tentativa.getTime() + (tentativa.getTime() - comoLoVeLaZona.getTime()));
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
