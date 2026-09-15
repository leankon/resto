import type { FranjaServicio, Id, Minutos } from './tipos';
import { aHHMM, aMinutos, diaSemanaDe, instanteLocal, sumarDias } from './tiempo';
import { resolverTurno, type ConfigTurnos } from './turnos';

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
 * Los minutos de ingreso que ofrece una franja, medidos desde la medianoche del día
 * de servicio. Una franja que cruza medianoche devuelve minutos ≥ 1440: la cena que
 * admite ingresos hasta las 00:30 del domingo sigue siendo la del sábado.
 */
function minutosDeIngreso(franja: FranjaServicio, paso: Minutos): number[] {
  const desde = aMinutos(franja.desde);
  const ultimo = aMinutos(franja.ultimoIngreso);
  const hasta = ultimo >= desde ? ultimo : ultimo + 1440;

  const minutos: number[] = [];
  // Se arranca en el primer múltiplo del paso que no sea anterior a la apertura: un
  // local que abre 19:45 con paso de 15 ofrece 19:45, no 19:30.
  for (let m = Math.ceil(desde / paso) * paso; m <= hasta; m += paso) minutos.push(m);
  return minutos;
}

/**
 * Los horarios a los que un grupo de N personas puede entrar en un día dado.
 *
 * No mira el estado de las mesas: dice cuándo el local está abierto para ese grupo,
 * no si hay lugar. La disponibilidad real sale de cruzar esto con el motor.
 *
 * Cada candidato pasa por `resolverTurno`, que es el mismo camino que usa la creación
 * de una reserva. Es deliberado: si la web ofreciera un horario con reglas propias,
 * el cliente elegiría uno que después el motor rechaza.
 */
export function horariosDelDia(
  fecha: string,
  personas: number,
  config: ConfigTurnos,
  paso: Minutos = PASO_POR_DEFECTO,
): Horario[] {
  const dia = diaSemanaDe(fecha);
  const porInstante = new Map<number, Horario>();

  for (const franja of config.franjas) {
    if (!franja.dias.includes(dia)) continue;

    for (const minutos of minutosDeIngreso(franja, paso)) {
      // Pasada la medianoche el reloj ya marca el día siguiente, aunque el servicio
      // siga siendo el de esta fecha.
      const fechaDelReloj = minutos >= 1440 ? sumarDias(fecha, 1) : fecha;
      const inicio = instanteLocal(fechaDelReloj, aHHMM(minutos), config.tz);

      const turno = resolverTurno(inicio, personas, config);
      if (turno.tipo !== 'ok' || turno.franjaId !== franja.id) continue;

      porInstante.set(inicio.getTime(), {
        hora: aHHMM(minutos),
        inicio,
        franjaId: franja.id,
        franjaNombre: franja.nombre,
        duracionMin: turno.duracionMin,
        bufferMin: turno.bufferMin,
      });
    }
  }

  return [...porInstante.values()].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}

/**
 * Las horas a las que tiene sentido mirar el salón en una fecha del almanaque.
 *
 * No es lo mismo que `horariosDelDia`. Ahí importa hasta cuándo se acepta que entre
 * gente; acá importa hasta cuándo hay gente sentada. Un local que toma el último
 * ingreso a las 01:00 y cierra a las 02:00 igual tiene mesas ocupadas a las 02:00, y el
 * encargado necesita poder mirarlas.
 *
 * Devuelve horas de reloj de ESA fecha, entre 00:00 y 23:59, porque es lo que hace la
 * planilla del día: la madrugada del domingo aparece en la planilla del domingo. Por eso
 * se juntan dos cosas —lo que abre ese día, y la cola de la noche anterior que termina
 * después de las doce—, y la cena que cruza medianoche se corta a la medianoche.
 */
export function horasDeApertura(
  fecha: string,
  config: ConfigTurnos,
  paso: Minutos = 60,
): string[] {
  const dia = diaSemanaDe(fecha);
  const ayer = ((dia + 6) % 7) as ReturnType<typeof diaSemanaDe>;
  const minutos = new Set<number>();

  const agregar = (desde: number, hasta: number) => {
    for (let m = Math.ceil(desde / paso) * paso; m <= hasta; m += paso) minutos.add(m);
    // Los bordes entran siempre, aunque no caigan en el paso: si el local abre 19:30,
    // la primera hora para mirar es 19:30 y no 20:00.
    minutos.add(desde);
    minutos.add(hasta);
  };

  for (const franja of config.franjas) {
    const desde = aMinutos(franja.desde);
    const cierre = aMinutos(franja.hasta);
    const cruza = cierre <= desde;

    // Lo que abre este día, hasta la medianoche como mucho.
    if (franja.dias.includes(dia)) agregar(desde, cruza ? 1440 : cierre);
    // Y la cola de la noche de ayer, que en el reloj ya es este día.
    if (cruza && franja.dias.includes(ayer)) agregar(0, cierre);
  }

  return [...minutos].sort((a, b) => a - b).map(aHHMM);
}
