import type { DiaSemana } from './tipos';

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

/** Fecha calendario (YYYY-MM-DD) en la zona del local. Es la clave del lock del día. */
export function fechaLocal(fecha: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
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

/** Día de la semana de una fecha calendario (YYYY-MM-DD), sin zona horaria de por medio. */
export function diaSemanaDe(fecha: string): DiaSemana {
  const d = new Date(`${fecha}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha inválida: ${fecha}`);
  return d.getUTCDay() as DiaSemana;
}

/** Minutos desde medianoche a "HH:MM". Inverso de `aMinutos`. */
export function aHHMM(minutos: number): string {
  const m = ((minutos % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
