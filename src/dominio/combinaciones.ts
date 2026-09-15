import type { Centimetros, ConfigAsignacion, Id, Mesa } from './tipos.js';

/**
 * Una mesa o un conjunto de mesas que se pueden unir, con su capacidad y su costo.
 *
 * Los candidatos se derivan del plano (D7): el local carga mesas, no combinaciones.
 */
/**
 * Compara nombres de mesa como los lee una persona: la 2 va antes que la 10.
 * `localeCompare` con `numeric` evita el orden lexicográfico que pondría "10" antes de "2".
 */
export function compararNatural(a: string, b: string): number {
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
}

export interface Candidato {
  /** Ids ordenados, unidos por "+". Clave estable del conjunto. */
  clave: string;
  /** Nombres de mesa como los dice el mozo: "3+4". Es lo que se lee en el log. */
  etiqueta: string;
  mesas: Mesa[];
  salonId: Id;
  /** Sillas sin agregar cabeceras, ya descontada la pérdida por unir. */
  capacidadNominal: number;
  /** Sillas de punta disponibles (máximo 2 en un combo: las de los dos extremos). */
  cabecerasDisponibles: number;
  capacidadMax: number;
  /** Debajo de esto el candidato no se ofrece, aunque entre. */
  capacidadMin: number;
  /** Cuánto hay que arrimar las mesas en total, en cm (árbol generador mínimo). */
  distanciaCm: Centimetros;
}

export type ParVetado = readonly [Id, Id];

function distancia(a: Mesa, b: Mesa): Centimetros {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function claveDePar(a: Id, b: Id): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Peso del árbol generador mínimo: cuánto hay que mover, en total, para armar la mesa. */
function costoDeUnir(mesas: Mesa[]): Centimetros {
  if (mesas.length < 2) return 0;
  const dentro = new Set<Id>([mesas[0]!.id]);
  let total = 0;
  while (dentro.size < mesas.length) {
    let mejor = Infinity;
    let elegida: Mesa | undefined;
    for (const candidata of mesas) {
      if (dentro.has(candidata.id)) continue;
      for (const puesta of mesas) {
        if (!dentro.has(puesta.id)) continue;
        const d = distancia(candidata, puesta);
        if (d < mejor) {
          mejor = d;
          elegida = candidata;
        }
      }
    }
    if (!elegida) break;
    dentro.add(elegida.id);
    total += mejor;
  }
  return total;
}

function armarCandidato(mesas: Mesa[], config: ConfigAsignacion): Candidato {
  // Orden de presentación por nombre; la clave se arma con los ids ordenados, que es
  // independiente de cómo se llamen las mesas.
  const ordenadas = [...mesas].sort(
    (a, b) => compararNatural(a.nombre, b.nombre) || (a.id < b.id ? -1 : 1),
  );
  const clave = mesas.map((m) => m.id).sort().join('+');
  const etiqueta = ordenadas.map((m) => m.nombre).join('+');
  const base = ordenadas.reduce((acc, m) => acc + m.capacidadBase, 0);
  const cabeceras = ordenadas.reduce((acc, m) => acc + m.cabeceras, 0);

  if (ordenadas.length === 1) {
    const mesa = ordenadas[0]!;
    return {
      clave,
      etiqueta,
      mesas: ordenadas,
      salonId: mesa.salonId,
      capacidadNominal: mesa.capacidadBase,
      cabecerasDisponibles: mesa.cabeceras,
      capacidadMax: mesa.capacidadBase + mesa.cabeceras,
      capacidadMin: mesa.capacidadMin,
      distanciaCm: 0,
    };
  }

  const capacidadNominal = base - config.perdidaPorUnion * (ordenadas.length - 1);
  // Al unir mesas solo quedan las dos puntas del conjunto.
  const cabecerasDisponibles = Math.min(2, cabeceras);
  // Un combo solo se ofrece si el grupo no entraba en ninguna de sus mesas por separado:
  // no tiene sentido proponer 3+4 para un grupo de 3.
  const mayorSuelta = Math.max(...ordenadas.map((m) => m.capacidadBase + m.cabeceras));

  return {
    clave,
    etiqueta,
    mesas: ordenadas,
    salonId: ordenadas[0]!.salonId,
    capacidadNominal,
    cabecerasDisponibles,
    capacidadMax: capacidadNominal + cabecerasDisponibles,
    capacidadMin: mayorSuelta + 1,
    distanciaCm: costoDeUnir(ordenadas),
  };
}

/**
 * Deriva todos los candidatos del plano: cada mesa suelta, más los subconjuntos conexos
 * de hasta `maxMesasPorCombo` mesas unibles.
 *
 * Dos mesas son unibles si están en el mismo salón, las dos son `combinable`, no están
 * vetadas, y sus centros están a menos de `radioCombinacionCm`.
 *
 * Conexo importa: tres mesas en fila (A–B–C) valen aunque A y C estén lejos entre sí,
 * porque B las une. Tres mesas en tres esquinas del salón, no.
 *
 * Se recalcula cuando cambia el plano, no en cada búsqueda.
 */
export function derivarCandidatos(
  mesas: Mesa[],
  config: ConfigAsignacion,
  vetados: readonly ParVetado[] = [],
): Candidato[] {
  const activas = mesas.filter((m) => m.activa);
  const veto = new Set(vetados.map(([a, b]) => claveDePar(a, b)));

  const unibles = new Map<Id, Set<Id>>(activas.map((m) => [m.id, new Set<Id>()]));
  for (let i = 0; i < activas.length; i++) {
    for (let j = i + 1; j < activas.length; j++) {
      const a = activas[i]!;
      const b = activas[j]!;
      if (a.salonId !== b.salonId) continue; // no se une la terraza con el interior (D9)
      if (!a.combinable || !b.combinable) continue;
      if (veto.has(claveDePar(a.id, b.id))) continue;
      if (distancia(a, b) > config.radioCombinacionCm) continue;
      unibles.get(a.id)!.add(b.id);
      unibles.get(b.id)!.add(a.id);
    }
  }

  const candidatos = activas.map((m) => armarCandidato([m], config));

  const vistos = new Set<string>();
  let frontera: Mesa[][] = activas.map((m) => [m]);
  const maximo = Math.max(1, config.maxMesasPorCombo);

  for (let tamaño = 2; tamaño <= maximo; tamaño++) {
    const siguiente: Mesa[][] = [];
    for (const grupo of frontera) {
      const ids = new Set(grupo.map((m) => m.id));
      for (const mesa of activas) {
        if (ids.has(mesa.id)) continue;
        const tocaElGrupo = grupo.some((m) => unibles.get(m.id)!.has(mesa.id));
        if (!tocaElGrupo) continue;

        const ampliado = [...grupo, mesa];
        const clave = ampliado
          .map((m) => m.id)
          .sort()
          .join('+');
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        siguiente.push(ampliado);
        candidatos.push(armarCandidato(ampliado, config));
      }
    }
    frontera = siguiente;
    if (frontera.length === 0) break;
  }

  return candidatos;
}
