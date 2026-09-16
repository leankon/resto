import type { DiaSemana, FranjaServicio, Id, Minutos, ReglaDuracion } from './tipos';
import {
  aMinutos,
  diaSemanaDe,
  fechaDeServicio,
  fechaLocal,
  instanteLocal,
  sumarDias,
} from './tiempo';

/**
 * Un día que se sale de la rutina: un feriado cerrado, un evento privado, o un día con
 * horario especial.
 */
export interface ExcepcionCalendario {
  id?: Id;
  /** YYYY-MM-DD en la zona del local. */
  fecha: string;
  cerrado: boolean;
  desde?: string | null;
  hasta?: string | null;
  /** Sin esto se acepta gente hasta la hora de cierre. */
  ultimoIngreso?: string | null;
  /** Reglas de duración a usar. `null` manda a las comodín. */
  franjaId?: Id | null;
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
  /** Último recurso. Cero: limpiar una mesa es pasar un trapo, no ocupa turno. */
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
function cruzaMedianoche(desde: string, hasta: string): boolean {
  return aMinutos(hasta) <= aMinutos(desde);
}

/**
 * Un tramo de servicio concreto de un día concreto: de tal hora a tal hora, con su
 * último ingreso.
 *
 * Es lo que queda después de aplicar las excepciones. Puede venir de una franja de la
 * semana o de un día especial, y al motor le da igual cuál de los dos.
 */
export interface TramoDelDia {
  id: Id;
  nombre: string;
  desde: string;
  hasta: string;
  ultimoIngreso: string;
  /**
   * La franja cuyas reglas de duración se aplican. `null` manda a las reglas comodín:
   * un día especial suelto no tiene por qué heredar la duración de nadie.
   */
  franjaId: Id | null;
}

export interface HorarioDelDia {
  tramos: TramoDelDia[];
  /** El día está cerrado por excepción. Lleva el motivo para poder explicarlo. */
  cerrado: { motivo: string | null } | null;
  /** Los tramos salen de un día especial y no del horario habitual. */
  esEspecial: boolean;
}

/**
 * El horario de un día de servicio, ya con las excepciones aplicadas.
 *
 * Un día especial **reemplaza** el horario de ese día, no lo recorta. Antes solo podía
 * achicar: si el local abre a las 20:00 y un feriado quiere abrir a las 18:00, con la
 * regla vieja no había forma de decirlo. Reemplazar cubre los dos casos —abrir antes,
 * abrir menos— y además deja abrir un día en el que normalmente está cerrado.
 */
export function horarioDelDia(fecha: string, config: ConfigTurnos): HorarioDelDia {
  const delDia = (config.excepciones ?? []).filter((e) => e.fecha === fecha);

  const cerrado = delDia.find((e) => e.cerrado);
  if (cerrado) return { tramos: [], cerrado: { motivo: cerrado.motivo ?? null }, esEspecial: true };

  const especiales = delDia.filter((e) => e.desde && e.hasta);
  if (especiales.length > 0) {
    return {
      esEspecial: true,
      cerrado: null,
      tramos: especiales.map((e, i) => ({
        id: e.id ?? `especial-${fecha}-${i}`,
        nombre: e.motivo?.trim() || 'Horario especial',
        desde: e.desde!,
        hasta: e.hasta!,
        // Sin último ingreso propio, se acepta gente hasta que cierra.
        ultimoIngreso: e.ultimoIngreso || e.hasta!,
        franjaId: e.franjaId ?? null,
      })),
    };
  }

  const dia = diaSemanaDe(fecha);
  return {
    esEspecial: false,
    cerrado: null,
    tramos: config.franjas
      .filter((f) => f.dias.includes(dia))
      .map((f) => ({
        id: f.id,
        nombre: f.nombre,
        desde: f.desde,
        hasta: f.hasta,
        ultimoIngreso: f.ultimoIngreso,
        franjaId: f.id,
      })),
  };
}

/** La ventana real de un tramo: dos instantes, resueltos en la zona del local. */
export function ventanaDelTramo(
  fecha: string,
  tramo: TramoDelDia,
  tz: string,
): { abre: Date; cierra: Date; ultimoIngreso: Date } {
  const pasaMedianoche = cruzaMedianoche(tramo.desde, tramo.hasta);
  const diaDelCierre = pasaMedianoche ? sumarDias(fecha, 1) : fecha;
  // El último ingreso también puede caer después de medianoche: una cena que cierra a
  // las 02:00 puede aceptar gente hasta la 01:00.
  const diaDelUltimo =
    aMinutos(tramo.ultimoIngreso) < aMinutos(tramo.desde) ? sumarDias(fecha, 1) : fecha;

  return {
    abre: instanteLocal(fecha, tramo.desde, tz),
    cierra: instanteLocal(diaDelCierre, tramo.hasta, tz),
    ultimoIngreso: instanteLocal(diaDelUltimo, tramo.ultimoIngreso, tz),
  };
}

/**
 * Resuelve a qué día de servicio y a qué tramo pertenece un instante.
 *
 * Se prueban dos días: el que marca el almanaque y el anterior. La cena del sábado que
 * cierra a las 02:00 hace que la 01:00 del domingo sea del sábado, así que el día de
 * ayer se prueba PRIMERO: si los dos dieran, gana el servicio que ya venía en curso.
 *
 * Trabaja con instantes reales y no con minutos desde la medianoche. Es más largo de
 * escribir y es lo correcto: en el día en que cambia la hora, un tramo de 20:00 a 02:00
 * no dura seis horas, y la aritmética de minutos no tiene forma de saberlo.
 */
function ubicar(
  inicio: Date,
  config: ConfigTurnos,
): { fecha: string; tramo: TramoDelDia; ventana: ReturnType<typeof ventanaDelTramo> } | null {
  const hoy = fechaLocal(inicio, config.tz);
  for (const fecha of [sumarDias(hoy, -1), hoy]) {
    for (const tramo of horarioDelDia(fecha, config).tramos) {
      const ventana = ventanaDelTramo(fecha, tramo, config.tz);
      if (inicio >= ventana.abre && inicio < ventana.cierra) return { fecha, tramo, ventana };
    }
  }
  return null;
}

/**
 * Resuelve en qué tramo cae la reserva y cuánto dura el turno (D1).
 *
 * Orden de resolución: regla de la franja → regla comodín → default de la plataforma.
 * El tramo se decide por la hora de INICIO, no por la de fin: simple y predecible para
 * una reserva que arranca cerca del cambio de franja.
 */
export function resolverTurno(
  inicio: Date,
  personas: number,
  config: ConfigTurnos,
): ResultadoTurno {
  const ubicado = ubicar(inicio, config);

  if (!ubicado) {
    // No cayó en ningún tramo. Puede ser que el local esté cerrado ese día por
    // excepción, y eso se explica distinto que "a esa hora no hay servicio": una cosa
    // es elegir mal la hora y otra es que el local no abra.
    const hoy = fechaLocal(inicio, config.tz);
    for (const fecha of [sumarDias(hoy, -1), hoy]) {
      const dia = horarioDelDia(fecha, config);
      if (!dia.cerrado) continue;
      // Se prueba contra el horario habitual: si a esa hora el local normalmente
      // estaría abierto, lo que pasa es que ese día está cerrado.
      const habitual = horarioDelDia(fecha, { ...config, excepciones: [] });
      for (const tramo of habitual.tramos) {
        const { abre, cierra } = ventanaDelTramo(fecha, tramo, config.tz);
        if (inicio >= abre && inicio < cierra) {
          return { tipo: 'cerrado_ese_dia', motivo: dia.cerrado.motivo };
        }
      }
    }
    return { tipo: 'fuera_de_servicio' };
  }

  const { tramo, ventana } = ubicado;
  if (inicio > ventana.ultimoIngreso) {
    return {
      tipo: 'despues_del_ultimo_ingreso',
      franjaNombre: tramo.nombre,
      ultimoIngreso: tramo.ultimoIngreso,
    };
  }

  const calza = (r: ReglaDuracion) => personas >= r.personasMin && personas <= r.personasMax;
  const deFranja = tramo.franjaId
    ? config.reglas.find((r) => r.franjaId === tramo.franjaId && calza(r))
    : undefined;
  const comodin = config.reglas.find((r) => r.franjaId === null && calza(r));
  const regla = deFranja ?? comodin;

  return {
    tipo: 'ok',
    franjaId: tramo.id,
    franjaNombre: tramo.nombre,
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
  // El tiempo de limpieza arranca en cero a propósito: entre dos comensales se pasa un
  // trapo y listo, no se le avisa a nadie y no se le cobra a la mesa. Reservarle quince
  // minutos a cada turno tira una mesa entera por noche a la basura. El local que
  // necesite margen de verdad —mantel, cubiertos, mesa larga— lo sube en el panel.
  const tramos: Array<[number, number, Minutos, Minutos, Minutos]> = [
    // personasMin, personasMax, almuerzo, cena, limpieza
    [1, 2, 75, 90, 0],
    [3, 4, 90, 105, 0],
    [5, 8, 105, 120, 0],
    [9, 99, 120, 150, 0],
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

/**
 * A qué hora del reloj termina el día de trabajo del local, en minutos desde la
 * medianoche. Es el corte entre un día de servicio y el siguiente.
 *
 * Un bar que cierra a las 02:00 devuelve 120: todo lo que pasa antes de las 02:00
 * pertenece a la noche anterior. El mozo que a la 01:00 sigue laburando está trabajando
 * el sábado, no el domingo, y su planilla tiene que decir lo mismo.
 *
 * Sale de las franjas y no de un valor aparte: si el local cambia el horario de cierre,
 * el corte lo sigue solo. Un local que cierra antes de medianoche devuelve 0, y ahí día
 * de servicio y día de almanaque son lo mismo.
 */
export function corteDelDia(config: ConfigTurnos): Minutos {
  let corte = 0;
  for (const franja of config.franjas) {
    if (!cruzaMedianoche(franja.desde, franja.hasta)) continue;
    corte = Math.max(corte, aMinutos(franja.hasta));
  }
  return corte;
}

/**
 * El día de servicio al que pertenece un instante: YYYY-MM-DD en hora del local.
 *
 * Correr el reloj hacia atrás hasta el corte y recién ahí mirar la fecha. Con cierre a
 * las 02:00, la reserva de la 01:00 del domingo se convierte en las 23:00 del sábado y
 * cae, como corresponde, en la planilla del sábado.
 */
export function diaDeServicio(inicio: Date, config: ConfigTurnos): string {
  return fechaDeServicio(inicio, config.tz, corteDelDia(config));
}
