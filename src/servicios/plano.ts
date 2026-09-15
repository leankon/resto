import type pg from 'pg';
import { conTenant } from '../datos/conexion';
import { compararNatural, derivarCandidatos, type Candidato } from '../dominio/combinaciones';
import { CONFIG_POR_DEFECTO, type ConfigAsignacion, type Mesa } from '../dominio/tipos';
import {
  cargarConfigAsignacion,
  cargarPlano,
  cargarVetados,
  type Actor,
} from '../datos/repositorios';

export interface MesaDelPlano extends Mesa {
  /** Reservas vigentes o futuras. Si tiene, la mesa no se puede borrar. */
  reservas: number;
}

export interface SalonDelPlano {
  id: string;
  nombre: string;
  orden: number;
  mesas: MesaDelPlano[];
}

export interface PlanoCompleto {
  salones: SalonDelPlano[];
  config: ConfigAsignacion;
  /** Lo que el motor va a poder armar con este plano. */
  combinaciones: CombinacionPosible[];
  vetadas: { mesaA: string; mesaB: string; nombreA: string; nombreB: string }[];
}

export interface CombinacionPosible {
  clave: string;
  etiqueta: string;
  salon: string;
  capacidad: string;
  distanciaCm: number;
  mesas: string[];
}

/**
 * El plano tal como lo ve el motor, más lo que el motor deduce de él.
 *
 * Mostrar las combinaciones derivadas es la mitad del valor de esta pantalla: el local
 * no carga combinaciones (D7), así que la única forma de saber si entendió bien el
 * criterio de cercanía es verlas listadas mientras acomoda las mesas.
 */
export async function cargarPlanoCompleto(
  pool: pg.Pool,
  tenantId: string,
): Promise<PlanoCompleto> {
  return conTenant(pool, tenantId, async (c) => {
    const [config, mesas, vetados] = await Promise.all([
      cargarConfigAsignacion(c, tenantId),
      cargarPlano(c, tenantId),
      cargarVetados(c, tenantId),
    ]);

    const salones = await c.query(
      `SELECT id, nombre, orden FROM salones
        WHERE tenant_id = $1 AND activo ORDER BY orden, nombre`,
      [tenantId],
    );
    const uso = await c.query(
      `SELECT mesa_id, count(*)::int AS n FROM reservas_mesas
        WHERE tenant_id = $1 AND bloqueante AND upper(periodo) > now()
        GROUP BY mesa_id`,
      [tenantId],
    );
    const reservasPorMesa = new Map<string, number>(uso.rows.map((f) => [f.mesa_id, f.n]));
    const nombrePorMesa = new Map(mesas.map((m) => [m.id, m.nombre]));

    const candidatos = derivarCandidatos(mesas, config, vetados);
    const porSalon = new Map(salones.rows.map((s) => [s.id, s.nombre as string]));

    return {
      config,
      salones: salones.rows.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        orden: s.orden,
        mesas: mesas
          .filter((m) => m.salonId === s.id)
          .map((m) => ({ ...m, reservas: reservasPorMesa.get(m.id) ?? 0 })),
      })),
      combinaciones: candidatos
        .filter((c) => c.mesas.length > 1)
        .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }))
        .map((c: Candidato) => ({
          clave: c.clave,
          etiqueta: c.etiqueta,
          salon: porSalon.get(c.salonId) ?? '',
          capacidad:
            c.cabecerasDisponibles > 0
              ? `${c.capacidadNominal}–${c.capacidadMax}`
              : String(c.capacidadMax),
          distanciaCm: Math.round(c.distanciaCm),
          mesas: c.mesas.map((m) => m.id),
        })),
      // El par se guarda ordenado por id, que no significa nada para quien lo lee.
      // Se muestra por nombre: "1 + 2", nunca "2 + 1".
      vetadas: vetados.map(([a, b]) => {
        const nombreA = nombrePorMesa.get(a) ?? '?';
        const nombreB = nombrePorMesa.get(b) ?? '?';
        return compararNatural(nombreA, nombreB) <= 0
          ? { mesaA: a, mesaB: b, nombreA, nombreB }
          : { mesaA: b, mesaB: a, nombreA: nombreB, nombreB: nombreA };
      }),
    };
  });
}

export async function crearSalon(
  pool: pg.Pool,
  tenantId: string,
  nombre: string,
): Promise<{ id: string }> {
  return conTenant(pool, tenantId, async (c) => {
    const { rows } = await c.query(
      `INSERT INTO salones (tenant_id, nombre, orden)
       VALUES ($1, $2, (SELECT coalesce(max(orden), -1) + 1 FROM salones WHERE tenant_id = $1))
       RETURNING id`,
      [tenantId, nombre.trim()],
    );
    return { id: rows[0].id as string };
  });
}

export async function renombrarSalon(
  pool: pg.Pool,
  tenantId: string,
  salonId: string,
  nombre: string,
): Promise<void> {
  await conTenant(pool, tenantId, (c) =>
    c.query(`UPDATE salones SET nombre = $2 WHERE id = $1`, [salonId, nombre.trim()]),
  );
}

export type ResultadoBorrado =
  | { tipo: 'borrado' }
  | { tipo: 'tiene_mesas'; mesas: number }
  | { tipo: 'tiene_reservas'; reservas: number };

/** Un salón con mesas no se borra: primero hay que decidir qué pasa con las mesas. */
export async function borrarSalon(
  pool: pg.Pool,
  tenantId: string,
  salonId: string,
): Promise<ResultadoBorrado> {
  return conTenant(pool, tenantId, async (c) => {
    const { rows } = await c.query(
      `SELECT count(*)::int AS n FROM mesas WHERE salon_id = $1 AND activa`,
      [salonId],
    );
    if (rows[0].n > 0) return { tipo: 'tiene_mesas' as const, mesas: rows[0].n };
    await c.query(`UPDATE salones SET activo = false WHERE id = $1`, [salonId]);
    return { tipo: 'borrado' as const };
  });
}

export interface DatosMesa {
  nombre: string;
  capacidadBase: number;
  cabeceras: number;
  capacidadMin: number;
  x: number;
  y: number;
  combinable: boolean;
}

export type ResultadoMesa =
  | { tipo: 'ok'; id: string }
  | { tipo: 'nombre_repetido' }
  | { tipo: 'datos_invalidos'; motivo: string };

function validar(datos: DatosMesa): string | null {
  if (!datos.nombre.trim()) return 'La mesa necesita un nombre.';
  if (datos.capacidadBase < 1 || datos.capacidadBase > 40) {
    return 'La capacidad tiene que estar entre 1 y 40.';
  }
  if (datos.cabeceras < 0 || datos.cabeceras > 2) {
    return 'Las cabeceras son como máximo dos: una en cada punta.';
  }
  if (datos.capacidadMin < 1 || datos.capacidadMin > datos.capacidadBase + datos.cabeceras) {
    return 'El mínimo no puede ser mayor que la capacidad de la mesa.';
  }
  return null;
}

export async function crearMesa(
  pool: pg.Pool,
  tenantId: string,
  salonId: string,
  datos: DatosMesa,
): Promise<ResultadoMesa> {
  const error = validar(datos);
  if (error) return { tipo: 'datos_invalidos', motivo: error };

  try {
    return await conTenant(pool, tenantId, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO mesas (tenant_id, salon_id, nombre, capacidad_base, cabeceras,
                            capacidad_min, x, y, combinable)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          tenantId, salonId, datos.nombre.trim(), datos.capacidadBase, datos.cabeceras,
          datos.capacidadMin, Math.round(datos.x), Math.round(datos.y), datos.combinable,
        ],
      );
      return { tipo: 'ok' as const, id: rows[0].id as string };
    });
  } catch (e) {
    if (esNombreRepetido(e)) return { tipo: 'nombre_repetido' };
    throw e;
  }
}

export async function actualizarMesa(
  pool: pg.Pool,
  tenantId: string,
  mesaId: string,
  datos: DatosMesa,
): Promise<ResultadoMesa> {
  const error = validar(datos);
  if (error) return { tipo: 'datos_invalidos', motivo: error };

  try {
    return await conTenant(pool, tenantId, async (c) => {
      await c.query(
        `UPDATE mesas SET nombre = $2, capacidad_base = $3, cabeceras = $4,
                          capacidad_min = $5, x = $6, y = $7, combinable = $8
          WHERE id = $1`,
        [
          mesaId, datos.nombre.trim(), datos.capacidadBase, datos.cabeceras,
          datos.capacidadMin, Math.round(datos.x), Math.round(datos.y), datos.combinable,
        ],
      );
      return { tipo: 'ok' as const, id: mesaId };
    });
  } catch (e) {
    if (esNombreRepetido(e)) return { tipo: 'nombre_repetido' };
    throw e;
  }
}

/** Solo la posición: es lo que cambia al arrastrar una mesa en el plano. */
export async function moverMesa(
  pool: pg.Pool,
  tenantId: string,
  mesaId: string,
  x: number,
  y: number,
): Promise<void> {
  await conTenant(pool, tenantId, (c) =>
    c.query(`UPDATE mesas SET x = $2, y = $3 WHERE id = $1`, [
      mesaId, Math.max(0, Math.round(x)), Math.max(0, Math.round(y)),
    ]),
  );
}

/**
 * Borrar una mesa con reservas por delante dejaría a esa gente sin dónde sentarse y
 * sin rastro de que tenían mesa. En ese caso se desactiva: deja de ofrecerse para
 * reservas nuevas pero las que ya están siguen en pie.
 */
export async function borrarMesa(
  pool: pg.Pool,
  tenantId: string,
  mesaId: string,
): Promise<ResultadoBorrado> {
  return conTenant(pool, tenantId, async (c) => {
    const { rows } = await c.query(
      `SELECT count(*)::int AS n FROM reservas_mesas
        WHERE mesa_id = $1 AND bloqueante AND upper(periodo) > now()`,
      [mesaId],
    );
    if (rows[0].n > 0) return { tipo: 'tiene_reservas' as const, reservas: rows[0].n };
    await c.query(`DELETE FROM mesas WHERE id = $1`, [mesaId]);
    return { tipo: 'borrado' as const };
  });
}

export async function cambiarActivaMesa(
  pool: pg.Pool,
  tenantId: string,
  mesaId: string,
  activa: boolean,
): Promise<void> {
  await conTenant(pool, tenantId, (c) =>
    c.query(`UPDATE mesas SET activa = $2 WHERE id = $1`, [mesaId, activa]),
  );
}

/** Dos mesas que el sistema uniría por cercanía pero en la práctica no se pueden unir. */
export async function vetarCombinacion(
  pool: pg.Pool,
  tenantId: string,
  mesaA: string,
  mesaB: string,
  motivo?: string,
): Promise<void> {
  const [a, b] = mesaA < mesaB ? [mesaA, mesaB] : [mesaB, mesaA];
  await conTenant(pool, tenantId, (c) =>
    c.query(
      `INSERT INTO combinaciones_vetadas (tenant_id, mesa_a_id, mesa_b_id, motivo)
       VALUES ($1, $2, $3, $4) ON CONFLICT (mesa_a_id, mesa_b_id) DO NOTHING`,
      [tenantId, a, b, motivo ?? null],
    ),
  );
}

export async function quitarVeto(
  pool: pg.Pool,
  tenantId: string,
  mesaA: string,
  mesaB: string,
): Promise<void> {
  const [a, b] = mesaA < mesaB ? [mesaA, mesaB] : [mesaB, mesaA];
  await conTenant(pool, tenantId, (c) =>
    c.query(`DELETE FROM combinaciones_vetadas WHERE mesa_a_id = $1 AND mesa_b_id = $2`, [a, b]),
  );
}

/** A qué distancia deja de tener sentido arrimar dos mesas. Cambia todo el plano. */
export async function cambiarRadioCombinacion(
  pool: pg.Pool,
  tenantId: string,
  radioCm: number,
): Promise<void> {
  const radio = Math.min(1000, Math.max(50, Math.round(radioCm)));
  await conTenant(pool, tenantId, (c) =>
    // Merge y no jsonb_set: si la clave 'asignacion' todavía no existe, jsonb_set
    // devuelve el objeto sin tocar y el cambio se pierde en silencio.
    c.query(
      `UPDATE tenants
          SET config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
                'asignacion',
                coalesce(config -> 'asignacion', '{}'::jsonb)
                  || jsonb_build_object('radioCombinacionCm', $2::int)),
              actualizado_en = now()
        WHERE id = $1`,
      [tenantId, radio],
    ),
  );
}

export const RADIO_POR_DEFECTO = CONFIG_POR_DEFECTO.radioCombinacionCm;

function esNombreRepetido(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null &&
    (e as { code?: string }).code === '23505' &&
    String((e as { constraint?: string }).constraint ?? '').includes('mesas')
  );
}

export type { Actor };
