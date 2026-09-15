import type { DiaSemana } from './tipos.js';

/** Convierte "HH:MM" a minutos desde medianoche. */
export function aMinutos(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Hora inválida: ${hhmm}`);
  const horas = Number(m[1]);
  const minutos = Number(m[2]);
  if (horas > 23 || minutos > 59) throw new Error(`Hora inválida: ${hhmm}`);
  return horas * 60 + minutos;
}

const DIAS: Record<string, DiaSemana> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Día de la semana y minutos desde medianoche, en la zona horaria del local.
 *
 * El dominio razona siempre en hora local: un local que abre a las 20:00 abre a las 20:00
 * de su ciudad, no en UTC. Guardamos `timestamptz` y convertimos acá.
 */
export function horaLocal(fecha: Date, tz: string): { dia: DiaSemana; minutos: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(fecha);

  let dia: DiaSemana | undefined;
  let horas = 0;
  let minutos = 0;
  for (const parte of partes) {
    if (parte.type === 'weekday') dia = DIAS[parte.value];
    else if (parte.type === 'hour') horas = Number(parte.value) % 24;
    else if (parte.type === 'minute') minutos = Number(parte.value);
  }
  if (dia === undefined) throw new Error(`Zona horaria inválida: ${tz}`);
  return { dia, minutos: horas * 60 + minutos };
}

export function sumarMinutos(fecha: Date, minutos: number): Date {
  return new Date(fecha.getTime() + minutos * 60_000);
}

export function seSolapan(
  a: { desde: Date; hasta: Date },
  b: { desde: Date; hasta: Date },
): boolean {
  // Semiabiertos [desde, hasta): tocarse en el borde no es solaparse.
  return a.desde < b.hasta && b.desde < a.hasta;
}
