import type { Id, Minutos } from './tipos';
import { aHHMM, aMinutos, instanteLocal, sumarDias } from './tiempo';
import {
  horarioDelDia,
  resolverTurno,
  ventanaDelTramo,
  type ConfigTurnos,
  type TramoDelDia,
} from './turnos';

/** Un horario al que el local acepta que entre gente, ya resuelto contra los turnos. */
export interface Horario {
  /** Hora local del local, "HH:MM". Es lo que se le muestra al cliente. */
  hora: string;
  inicio: Date;
  franjaId: Id;
  franjaNombre: string;
  duracionMin: Minutos;
  bufferMin: Minutos;
}

/** Cada cuántos minutos se ofrece un horario. 15 es el grano habitual del rubro. */
export const PASO_POR_DEFECTO = 15;

/**
 * Los minutos de ingreso que ofrece un tramo, medidos desde la medianoche del día de
 * servicio. Un tramo que cruza medianoche devuelve minutos ≥ 1440: la cena que admite
 * ingresos hasta las 00:30 del domingo sigue siendo la del sábado.
 */
function minutosDeIngreso(tramo: TramoDelDia, paso: Minutos): number[] {
  const desde = aMinutos(tramo.desde);
  const ultimo = aMinutos(tramo.ultimoIngreso);
  const hasta = ultimo >= desde ? ultimo : ultimo + 1440;

  const minutos: number[] = [];
  // Se arranca en el primer múltiplo del paso que no sea anterior a la apertura: un
  // local que abre 19:45 con paso de 15 ofrece 19:45, no 19:30.
  for (let m = Math.ceil(desde / paso) * paso; m <= hasta; m += paso) minutos.push(m);
  return minutos;
}

/** El instante de una hora medida desde la medianoche del día de servicio. */
function instanteDe(fecha: string, minutos: number, tz: string): Date {
  return instanteLocal(minutos >= 1440 ? sumarDias(fecha, 1) : fecha, aHHMM(minutos), tz);
}

/**
 * Los horarios a los que un grupo de N personas puede entrar en un día de servicio.
 *
 * No mira el estado de las mesas: dice cuándo el local está abierto para ese grupo, no
 * si hay lugar. La disponibilidad real sale de cruzar esto con el motor.
 *
 * Los candidatos salen del horario EFECTIVO del día —con los días especiales ya
 * aplicados—, y después cada uno pasa por `resolverTurno`, que es el mismo camino que
 * usa la creación de una reserva. Es deliberado: si la web ofreciera un horario con
 * reglas propias, el cliente elegiría uno que después el motor rechaza.
 */
export function horariosDelDia(
  fecha: string,
  personas: number,
  config: ConfigTurnos,
  paso: Minutos = PASO_POR_DEFECTO,
): Horario[] {
  const porInstante = new Map<number, Horario>();

  for (const tramo of horarioDelDia(fecha, config).tramos) {
    for (const minutos of minutosDeIngreso(tramo, paso)) {
      const inicio = instanteDe(fecha, minutos, config.tz);
      const turno = resolverTurno(inicio, personas, config);
      if (turno.tipo !== 'ok' || turno.franjaId !== tramo.id) continue;

      porInstante.set(inicio.getTime(), {
        hora: aHHMM(minutos),
        inicio,
        franjaId: tramo.id,
        franjaNombre: tramo.nombre,
        duracionMin: turno.duracionMin,
        bufferMin: turno.bufferMin,
      });
    }
  }

  return [...porInstante.values()].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}

/**
 * Las horas a las que tiene sentido mirar el salón en un día de servicio.
 *
 * No es lo mismo que `horariosDelDia`. Ahí importa hasta cuándo se acepta que entre
 * gente; acá importa hasta cuándo hay gente sentada. Un local que toma el último
 * ingreso a las 01:00 y cierra a las 02:00 igual tiene mesas ocupadas a las 02:00, y el
 * encargado necesita poder mirarlas.
 *
 * Son horas del DÍA DE SERVICIO, igual que la planilla: la madrugada del domingo forma
 * parte del sábado y va al final de la lista del sábado, no al principio de la del
 * domingo. Por eso se devuelven ordenadas por el momento real y no por la etiqueta.
 */
export function horasDeApertura(
  fecha: string,
  config: ConfigTurnos,
  paso: Minutos = PASO_POR_DEFECTO,
): string[] {
  const minutos = new Set<number>();

  for (const tramo of horarioDelDia(fecha, config).tramos) {
    const desde = aMinutos(tramo.desde);
    const cierre = aMinutos(tramo.hasta);
    // Cierra a una hora menor o igual a la de apertura: cruza la medianoche, y esos
    // minutos siguen contando en este día de servicio.
    const hasta = cierre <= desde ? cierre + 1440 : cierre;

    for (let m = Math.ceil(desde / paso) * paso; m <= hasta; m += paso) minutos.add(m);
    // Los bordes entran siempre, aunque no caigan en el paso: si el local abre 19:35,
    // la primera hora para mirar es 19:35 y no 19:45.
    minutos.add(desde);
    minutos.add(hasta);
  }

  return [...minutos].sort((a, b) => a - b).map(aHHMM);
}

/**
 * El instante real detrás de una hora del plano.
 *
 * "01:00 del sábado" es, en el reloj, la 01:00 del domingo. Sin esta cuenta, mirar el
 * salón a la 01:00 muestra la madrugada equivocada: la de veinticuatro horas antes.
 */
export function instanteDeServicio(
  fecha: string,
  hora: string,
  tz: string,
  corteMin: Minutos,
): Date {
  // El corte entra: a las 02:00 de un local que cierra a las 02:00 todavía se está
  // mirando la noche anterior, que es el momento en que se van los últimos.
  const esMadrugada = corteMin > 0 && aMinutos(hora) <= corteMin;
  return instanteLocal(esMadrugada ? sumarDias(fecha, 1) : fecha, hora, tz);
}

export { ventanaDelTramo };
