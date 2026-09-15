import type { Candidato } from './combinaciones.js';
import type { ConfigAsignacion, Id, Mesa, Minutos, Ocupacion, Periodo } from './tipos.js';
import { seSolapan, sumarMinutos } from './tiempo.js';

export const VERSION_ALGORITMO = '1.0.0';

export interface Pedido {
  inicio: Date;
  personas: number;
  duracionMin: Minutos;
  bufferMin: Minutos;
  salonPreferido?: Id;
}

export interface DetallePuntaje {
  desperdicio: number;
  /** Recargo sobre el desperdicio por tratarse de una mesa escasa. */
  mesaExtra: number;
  distancia: number;
  cabeceras: number;
  escasez: number;
  fragmentacion: number;
  salonNoPreferido: number;
}

export interface CandidatoEvaluado {
  clave: string;
  mesas: Id[];
  capacidadNominal: number;
  capacidadMax: number;
  cabecerasUsadas: number;
  puntaje: number;
  detalle: DetallePuntaje;
}

export interface Descartado {
  clave: string;
  motivo: string;
}

/**
 * El "por qué" de cada decisión. Guardar también los descartados con su motivo es lo que
 * permite responder la pregunta que el local hace siempre: "¿por qué me dijo que no había
 * lugar si la mesa 7 estaba vacía?".
 */
export interface Explicacion {
  versionAlgoritmo: string;
  entrada: {
    inicio: string;
    personas: number;
    duracionMin: Minutos;
    bufferMin: Minutos;
    salonPreferido?: Id;
  };
  /** true si hubo que ignorar `capacidadMin` porque si no, no entraba en ningún lado. */
  capacidadMinRelajada: boolean;
  evaluados: CandidatoEvaluado[];
  descartados: Descartado[];
  elegido: string | null;
  ms: number;
}

export type ResultadoAsignacion =
  | {
      tipo: 'asignada';
      mesas: Mesa[];
      periodo: Periodo;
      cabecerasUsadas: number;
      log: Explicacion;
    }
  | { tipo: 'sin_lugar'; log: Explicacion };

/**
 * Qué tan escasa es una mesa de este tamaño. La única mesa de 8 del salón vale 1.0;
 * una mesa de 2 entre veinte iguales vale 0.05. Es lo que evita regalarle la mesa grande
 * al primero que pasa.
 */
function rarezas(candidatos: Candidato[]): Map<Id, number> {
  const sueltas = candidatos.filter((c) => c.mesas.length === 1).map((c) => c.mesas[0]!);
  const mapa = new Map<Id, number>();
  for (const mesa of sueltas) {
    const capacidad = mesa.capacidadBase + mesa.cabeceras;
    const igualesOMayores = sueltas.filter(
      (otra) => otra.capacidadBase + otra.cabeceras >= capacidad,
    ).length;
    mapa.set(mesa.id, igualesOMayores > 0 ? 1 / igualesOMayores : 1);
  }
  return mapa;
}

/**
 * Cuántos huecos inservibles deja esta reserva. Un hueco más corto que el turno mínimo
 * es capacidad que ya no se puede vender.
 */
function fragmentacion(
  candidato: Candidato,
  periodo: Periodo,
  porMesa: Map<Id, Ocupacion[]>,
  config: ConfigAsignacion,
): number {
  const minimo = config.duracionMinimaTurnoMin * 60_000;
  let huecos = 0;

  for (const mesa of candidato.mesas) {
    const ocupaciones = porMesa.get(mesa.id) ?? [];
    let anterior: Date | null = null;
    let siguiente: Date | null = null;

    for (const ocupacion of ocupaciones) {
      if (ocupacion.periodo.hasta <= periodo.desde) {
        if (!anterior || ocupacion.periodo.hasta > anterior) anterior = ocupacion.periodo.hasta;
      }
      if (ocupacion.periodo.desde >= periodo.hasta) {
        if (!siguiente || ocupacion.periodo.desde < siguiente) siguiente = ocupacion.periodo.desde;
      }
    }

    // Solo se penaliza contra una reserva real. Sin vecino, el hueco lo limita el horario
    // de servicio, que el motor no conoce acá.
    if (anterior) {
      const hueco = periodo.desde.getTime() - anterior.getTime();
      if (hueco > 0 && hueco < minimo) huecos++;
    }
    if (siguiente) {
      const hueco = siguiente.getTime() - periodo.hasta.getTime();
      if (hueco > 0 && hueco < minimo) huecos++;
    }
  }
  return huecos;
}

/**
 * Elige la mejor mesa o combinación libre para un pedido.
 *
 * Función pura: recibe el estado del salón ya cargado y devuelve una decisión con su
 * explicación. No toca la base, no conoce transacciones, no sabe qué es un tenant.
 * El caller se encarga del advisory lock y de la constraint EXCLUDE.
 */
export function asignar(
  candidatos: Candidato[],
  ocupaciones: Ocupacion[],
  pedido: Pedido,
  config: ConfigAsignacion,
): ResultadoAsignacion {
  const arranque = Date.now();
  const periodo: Periodo = {
    desde: pedido.inicio,
    hasta: sumarMinutos(pedido.inicio, pedido.duracionMin + pedido.bufferMin),
  };

  const porMesa = new Map<Id, Ocupacion[]>();
  for (const ocupacion of ocupaciones) {
    const lista = porMesa.get(ocupacion.mesaId);
    if (lista) lista.push(ocupacion);
    else porMesa.set(ocupacion.mesaId, [ocupacion]);
  }

  const ocupada = (mesaId: Id) =>
    (porMesa.get(mesaId) ?? []).some((o) => seSolapan(o.periodo, periodo));

  const rareza = rarezas(candidatos);
  const { pesos } = config;

  const descartados: Descartado[] = [];
  const libresQueEntran: Candidato[] = [];
  let hayAlgunoSinCapacidadMin = false;

  for (const candidato of candidatos) {
    if (pedido.personas > candidato.capacidadMax) {
      descartados.push({ clave: candidato.clave, motivo: 'no entra el grupo' });
      continue;
    }
    const chocan = candidato.mesas.filter((m) => ocupada(m.id));
    if (chocan.length > 0) {
      descartados.push({
        clave: candidato.clave,
        motivo: `ocupada: ${chocan.map((m) => m.nombre).join(', ')}`,
      });
      continue;
    }
    if (pedido.personas < candidato.capacidadMin) {
      hayAlgunoSinCapacidadMin = true;
      descartados.push({ clave: candidato.clave, motivo: 'grupo muy chico para esta mesa' });
      continue;
    }
    libresQueEntran.push(candidato);
  }

  // `capacidadMin` es una preferencia, no una restricción física: si no hay otra cosa,
  // es mejor sentar a la pareja en la mesa de 10 que decirle que no hay lugar.
  let capacidadMinRelajada = false;
  let finalistas = libresQueEntran;
  if (finalistas.length === 0 && hayAlgunoSinCapacidadMin) {
    capacidadMinRelajada = true;
    finalistas = candidatos.filter(
      (c) => pedido.personas <= c.capacidadMax && !c.mesas.some((m) => ocupada(m.id)),
    );
  }

  const evaluados: CandidatoEvaluado[] = finalistas.map((candidato) => {
    const cabecerasUsadas = Math.max(0, pedido.personas - candidato.capacidadNominal);
    const sillasQueSobran = Math.max(0, candidato.capacidadNominal - pedido.personas);
    const huecos = fragmentacion(candidato, periodo, porMesa, config);
    const salonMal =
      pedido.salonPreferido && candidato.salonId !== pedido.salonPreferido ? 1 : 0;

    // La escasez no es un costo aparte: es un recargo sobre el desperdicio. Ocupar la
    // única mesa de 8 con un grupo de 8 no tiene nada de malo; el problema es ocuparla
    // con un grupo de 6. Sumarla suelta hacía que dos candidatos sin desperdicio se
    // diferenciaran solo por el tamaño de sus mesas, y los puntajes quedaban empatados.
    const masEscasa = Math.max(0, ...candidato.mesas.map((m) => rareza.get(m.id) ?? 0));
    const desperdicioBase = sillasQueSobran * pesos.desperdicio;

    const detalle: DetallePuntaje = {
      desperdicio: desperdicioBase,
      escasez: desperdicioBase * masEscasa * pesos.escasez,
      mesaExtra: (candidato.mesas.length - 1) * pesos.mesaExtra,
      distancia: (candidato.distanciaCm / 100) * pesos.distanciaPorMetro,
      cabeceras: cabecerasUsadas * pesos.cabecera,
      fragmentacion: huecos * pesos.fragmentacion,
      salonNoPreferido: salonMal * pesos.salonNoPreferido,
    };
    const puntaje = Object.values(detalle).reduce((a, b) => a + b, 0);

    return {
      clave: candidato.clave,
      mesas: candidato.mesas.map((m) => m.id),
      capacidadNominal: candidato.capacidadNominal,
      capacidadMax: candidato.capacidadMax,
      cabecerasUsadas,
      puntaje,
      detalle,
    };
  });

  // Desempate determinista por clave: el mismo input da siempre el mismo output, que es
  // lo que hace testeable al motor y reproducible un reclamo del local.
  evaluados.sort((a, b) => a.puntaje - b.puntaje || (a.clave < b.clave ? -1 : 1));

  const ganador = evaluados[0];
  const log: Explicacion = {
    versionAlgoritmo: VERSION_ALGORITMO,
    entrada: {
      inicio: pedido.inicio.toISOString(),
      personas: pedido.personas,
      duracionMin: pedido.duracionMin,
      bufferMin: pedido.bufferMin,
      ...(pedido.salonPreferido ? { salonPreferido: pedido.salonPreferido } : {}),
    },
    capacidadMinRelajada,
    evaluados,
    descartados,
    elegido: ganador?.clave ?? null,
    ms: Date.now() - arranque,
  };

  if (!ganador) return { tipo: 'sin_lugar', log };

  const elegido = finalistas.find((c) => c.clave === ganador.clave)!;
  return {
    tipo: 'asignada',
    mesas: elegido.mesas,
    periodo,
    cabecerasUsadas: ganador.cabecerasUsadas,
    log,
  };
}

export interface Alternativa {
  inicio: Date;
  desplazamientoMin: Minutos;
  mesas: Id[];
}

/**
 * Cuando no hay lugar en el horario pedido, buscar cerca antes de ofrecer lista de espera.
 * Los desplazamientos son múltiplos de la grilla de 15 minutos (D8).
 */
export function buscarAlternativas(
  candidatos: Candidato[],
  ocupaciones: Ocupacion[],
  pedido: Pedido,
  config: ConfigAsignacion,
  desplazamientos: Minutos[] = [-30, -15, 15, 30, 45, 60],
): Alternativa[] {
  const alternativas: Alternativa[] = [];
  for (const desplazamiento of desplazamientos) {
    const inicio = sumarMinutos(pedido.inicio, desplazamiento);
    const resultado = asignar(candidatos, ocupaciones, { ...pedido, inicio }, config);
    if (resultado.tipo === 'asignada') {
      alternativas.push({
        inicio,
        desplazamientoMin: desplazamiento,
        mesas: resultado.mesas.map((m) => m.id),
      });
    }
  }
  return alternativas.sort(
    (a, b) => Math.abs(a.desplazamientoMin) - Math.abs(b.desplazamientoMin),
  );
}
