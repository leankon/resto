import type { DiaSemana, FranjaServicio, Id, Minutos, ReglaDuracion } from './tipos';
import { aMinutos, fechaLocal, horaLocal } from './tiempo';

/**
 * Un día que se sale de la rutina: un feriado cerrado, un evento privado, o un día con
 * horario especial.
 */
export interface ExcepcionCalendario {
  /** YYYY-MM-DD en la zona del local. */
  fecha: string;
  cerrado: boolean;
  desde?: string | null;
  hasta?: string | null;
  motivo?: string | null;
}

export interface ConfigTurnos {
  /** IANA, ej. "America/Argentina/Buenos_Aires". */
  tz: string;
  franjas: FranjaServicio[];
  reglas: ReglaDuracion[];
  excepciones?: ExcepcionCalendario[];
  /** Último recurso si el local no configuró ninguna regla que aplique. */
  duracionPorDefecto: Minutos;
  bufferPorDefecto: Minutos;
}

export type ResultadoTurno =
  | {
      tipo: 'ok';
      franjaId: Id;
      franjaNombre: string;
      duracionMin: Minutos;
      bufferMin: Minutos;
      /** De dónde salió la duración, para el log de asignación. */
      origenRegla: 'franja' | 'comodin' | 'defecto';
    }
  | { tipo: 'fuera_de_servicio' }
  | { tipo: 'cerrado_ese_dia'; motivo: string | null }
  | { tipo: 'despues_del_ultimo_ingreso'; franjaNombre: string; ultimoIngreso: string };

/** Una franja cruza medianoche cuando cierra a una hora menor o igual a la que abre. */
function cruzaMedianoche(franja: FranjaServicio): boolean {
  return aMinutos(franja.hasta) <= aMinutos(franja.desde);
}

function aplica(franja: FranjaServicio, dia: DiaSemana, minutos: number): boolean {
  const desde = aMinutos(franja.desde);
  const hasta = aMinutos(franja.hasta);

  if (!cruzaMedianoche(franja)) {
    return franja.dias.includes(dia) && minutos >= desde && minutos < hasta;
  }
  // La cena de sábado que termina a las 02:00 pertenece al sábado, aunque el reloj
  // ya marque domingo. Sin esto, todo bar nocturno queda "fuera de servicio".
  if (minutos >= desde) return franja.dias.includes(dia);
  if (minutos < hasta) return franja.dias.includes(((dia + 6) % 7) as DiaSemana);
  return false;
}

/**
 * Resuelve en qué franja cae la reserva y cuánto dura el turno (D1).
 *
 * Orden de resolución: regla de la franja → regla comodín → default de la plataforma.
 * La franja se decide por la hora de INICIO, no por la de fin: simple y predecible
 * para una reserva que arranca cerca del cambio de franja.
 */
export function resolverTurno(
  inicio: Date,
  personas: number,
  config: ConfigTurnos,
): ResultadoTurno {
  const { dia, minutos } = horaLocal(inicio, config.tz);

  const franja = config.franjas.find((f) => aplica(f, dia, minutos));
  if (!franja) return { tipo: 'fuera_de_servicio' };

  // La excepción se busca por el día de SERVICIO, no por el del almanaque: si el local
  // cierra el 25 y la cena de ese día termina a las 02:00, la reserva de la 01:00 del
  // 26 pertenece al 25 y también está cerrada.
  const diaDeServicio =
    cruzaMedianoche(franja) && minutos < aMinutos(franja.hasta)
      ? fechaLocal(new Date(inicio.getTime() - 86_400_000), config.tz)
      : fechaLocal(inicio, config.tz);

  const excepcion = config.excepciones?.find((e) => e.fecha === diaDeServicio);
  if (excepcion?.cerrado) return { tipo: 'cerrado_ese_dia', motivo: excepcion?.motivo ?? null };
  if (excepcion?.desde && excepcion?.hasta) {
    // Horario especial: reemplaza al de la franja solo por ese día.
    const desde = aMinutos(excepcion.desde);
    const hasta = aMinutos(excepcion.hasta);
    const dentro = hasta <= desde
      ? minutos >= desde || minutos < hasta
      : minutos >= desde && minutos < hasta;
    if (!dentro) return { tipo: 'fuera_de_servicio' };
  }

  const ultimo = aMinutos(franja.ultimoIngreso);
  const pasoElUltimoIngreso = cruzaMedianoche(franja)
    ? minutos > ultimo && minutos < aMinutos(franja.desde)
    : minutos > ultimo;
  if (pasoElUltimoIngreso) {
    return {
      tipo: 'despues_del_ultimo_ingreso',
      franjaNombre: franja.nombre,
      ultimoIngreso: franja.ultimoIngreso,
    };
  }

  const calza = (r: ReglaDuracion) => personas >= r.personasMin && personas <= r.personasMax;
  const deFranja = config.reglas.find((r) => r.franjaId === franja.id && calza(r));
  const comodin = config.reglas.find((r) => r.franjaId === null && calza(r));
  const regla = deFranja ?? comodin;

  return {
    tipo: 'ok',
    franjaId: franja.id,
    franjaNombre: franja.nombre,
    duracionMin: regla?.duracionMin ?? config.duracionPorDefecto,
    bufferMin: regla?.bufferMin ?? config.bufferPorDefecto,
    origenRegla: deFranja ? 'franja' : comodin ? 'comodin' : 'defecto',
  };
}

/** Reglas sembradas al dar de alta un local. Editables desde el panel. */
export function reglasSembradas(
  franjaAlmuerzo: Id | null,
  franjaCena: Id | null,
): ReglaDuracion[] {
  const tramos: Array<[number, number, Minutos, Minutos, Minutos]> = [
    // personasMin, personasMax, almuerzo, cena, buffer
    [1, 2, 75, 90, 15],
    [3, 4, 90, 105, 15],
    [5, 8, 105, 120, 20],
    [9, 99, 120, 150, 20],
  ];
  const reglas: ReglaDuracion[] = [];
  for (const [min, max, almuerzo, cena, buffer] of tramos) {
    if (franjaAlmuerzo) {
      reglas.push({
        franjaId: franjaAlmuerzo,
        personasMin: min,
        personasMax: max,
        duracionMin: almuerzo,
        bufferMin: buffer,
      });
    }
    if (franjaCena) {
      reglas.push({
        franjaId: franjaCena,
        personasMin: min,
        personasMax: max,
        duracionMin: cena,
        bufferMin: buffer,
      });
    }
    // Comodín: el local puede crear franjas nuevas (brunch, after office) sin quedarse
    // sin reglas hasta que las configure.
    reglas.push({
      franjaId: null,
      personasMin: min,
      personasMax: max,
      duracionMin: cena,
      bufferMin: buffer,
    });
  }
  return reglas;
}
