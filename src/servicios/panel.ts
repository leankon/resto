import type pg from 'pg';
import { conTenant } from '../datos/conexion';

export interface ReservaDelDia {
  id: string;
  inicio: Date;
  fin: Date;
  personas: number;
  estado: string;
  canalOrigen: string;
  notas: string | null;
  mesas: string[];
  salon: string | null;
  cliente: {
    id: string;
    nombre: string;
    telefono: string | null;
    email: string | null;
    visitas: number;
    noShows: number;
  } | null;
  /** true si no hay por dónde avisarle nada. El panel tiene que mostrarlo. */
  sinContacto: boolean;
}

/**
 * Reservas de un día, en la zona horaria del local.
 *
 * El día se calcula en hora local y no en UTC: para un bar que cierra a las 02:00,
 * la reserva de la 01:00 del domingo es parte del servicio del sábado y tiene que
 * aparecer en la planilla del sábado.
 */
export async function reservasDelDia(
  pool: pg.Pool,
  tenantId: string,
  fecha: string,
): Promise<ReservaDelDia[]> {
  return conTenant(pool, tenantId, async (c) => {
    const { rows } = await c.query(
      `WITH tz AS (SELECT tz FROM tenants WHERE id = $1)
       SELECT r.id, r.inicio, r.personas, r.estado, r.canal_origen, r.notas,
              r.inicio + (r.duracion_min || ' minutes')::interval AS fin,
              cl.id AS cliente_id, cl.nombre, cl.telefono_e164, cl.email,
              cl.visitas, cl.no_shows,
              coalesce(
                (SELECT array_agg(m.nombre ORDER BY m.nombre)
                   FROM reservas_mesas rm JOIN mesas m ON m.id = rm.mesa_id
                  WHERE rm.reserva_id = r.id), '{}') AS mesas,
              (SELECT s.nombre FROM reservas_mesas rm
                 JOIN mesas m ON m.id = rm.mesa_id JOIN salones s ON s.id = m.salon_id
                WHERE rm.reserva_id = r.id LIMIT 1) AS salon
         FROM reservas r
         LEFT JOIN clientes cl ON cl.id = r.cliente_id
         CROSS JOIN tz
        WHERE r.tenant_id = $1
          AND (r.inicio AT TIME ZONE tz.tz)::date = $2::date
        ORDER BY r.inicio, mesas`,
      [tenantId, fecha],
    );

    return rows.map((f) => ({
      id: f.id,
      inicio: f.inicio,
      fin: f.fin,
      personas: f.personas,
      estado: f.estado,
      canalOrigen: f.canal_origen,
      notas: f.notas,
      mesas: f.mesas,
      salon: f.salon,
      cliente: f.cliente_id
        ? {
            id: f.cliente_id,
            nombre: f.nombre,
            telefono: f.telefono_e164,
            email: f.email,
            visitas: f.visitas,
            noShows: f.no_shows,
          }
        : null,
      sinContacto: Boolean(f.cliente_id) && !f.telefono_e164 && !f.email,
    }));
  });
}

/** Una reserva puntual, para la pantalla de detalle. */
export async function reservaPorId(
  pool: pg.Pool,
  tenantId: string,
  reservaId: string,
): Promise<ReservaDelDia | null> {
  return conTenant(pool, tenantId, async (c) => {
    const { rows } = await c.query(
      `SELECT r.id, r.inicio, r.personas, r.estado, r.canal_origen, r.notas,
              r.inicio + (r.duracion_min || ' minutes')::interval AS fin,
              cl.id AS cliente_id, cl.nombre, cl.telefono_e164, cl.email,
              cl.visitas, cl.no_shows,
              coalesce(
                (SELECT array_agg(m.nombre ORDER BY m.nombre)
                   FROM reservas_mesas rm JOIN mesas m ON m.id = rm.mesa_id
                  WHERE rm.reserva_id = r.id), '{}') AS mesas,
              (SELECT s.nombre FROM reservas_mesas rm
                 JOIN mesas m ON m.id = rm.mesa_id JOIN salones s ON s.id = m.salon_id
                WHERE rm.reserva_id = r.id LIMIT 1) AS salon
         FROM reservas r LEFT JOIN clientes cl ON cl.id = r.cliente_id
        WHERE r.id = $1`,
      [reservaId],
    );
    const f = rows[0];
    if (!f) return null;
    return {
      id: f.id,
      inicio: f.inicio,
      fin: f.fin,
      personas: f.personas,
      estado: f.estado,
      canalOrigen: f.canal_origen,
      notas: f.notas,
      mesas: f.mesas,
      salon: f.salon,
      cliente: f.cliente_id
        ? {
            id: f.cliente_id,
            nombre: f.nombre,
            telefono: f.telefono_e164,
            email: f.email,
            visitas: f.visitas,
            noShows: f.no_shows,
          }
        : null,
      sinContacto: Boolean(f.cliente_id) && !f.telefono_e164 && !f.email,
    };
  });
}

export interface BloqueDeOcupacion {
  hora: string;
  personas: number;
  reservas: number;
}

/**
 * Gente que entra por bloque de 15 minutos.
 *
 * Decidimos no frenar reservas por capacidad de cocina (D5): mejor lleno con demora.
 * Pero el encargado necesita ver venir el pico aunque el sistema no lo frene, así que
 * el dato tiene que estar a la vista.
 */
export async function ingresosPorBloque(
  pool: pg.Pool,
  tenantId: string,
  fecha: string,
): Promise<BloqueDeOcupacion[]> {
  return conTenant(pool, tenantId, async (c) => {
    const { rows } = await c.query(
      `WITH tz AS (SELECT tz FROM tenants WHERE id = $1)
       SELECT to_char(
                date_trunc('hour', r.inicio AT TIME ZONE tz.tz)
                  + interval '15 min' * floor(extract(minute FROM r.inicio AT TIME ZONE tz.tz) / 15),
                'HH24:MI') AS hora,
              sum(r.personas)::int AS personas,
              count(*)::int AS reservas
         FROM reservas r CROSS JOIN tz
        WHERE r.tenant_id = $1
          AND (r.inicio AT TIME ZONE tz.tz)::date = $2::date
          AND r.estado NOT IN ('cancelada', 'no_show')
        GROUP BY 1 ORDER BY 1`,
      [tenantId, fecha],
    );
    return rows.map((f) => ({ hora: f.hora, personas: f.personas, reservas: f.reservas }));
  });
}

export interface MesaEnPlano {
  id: string;
  nombre: string;
  capacidadBase: number;
  cabeceras: number;
  x: number;
  y: number;
  ocupadaPor: { reservaId: string; cliente: string | null; personas: number; estado: string } | null;
}

export interface SalonEnPlano {
  id: string;
  nombre: string;
  mesas: MesaEnPlano[];
}

/** El salón tal como está en un momento dado. Una solapa por piso en el panel (D9). */
export async function estadoDelSalon(
  pool: pg.Pool,
  tenantId: string,
  momento: Date,
): Promise<SalonEnPlano[]> {
  return conTenant(pool, tenantId, async (c) => {
    const { rows } = await c.query(
      `SELECT s.id AS salon_id, s.nombre AS salon, m.id, m.nombre,
              m.capacidad_base, m.cabeceras, m.x, m.y,
              r.id AS reserva_id, r.personas, r.estado, cl.nombre AS cliente
         FROM salones s
         JOIN mesas m ON m.salon_id = s.id AND m.activa
         LEFT JOIN reservas_mesas rm
                ON rm.mesa_id = m.id AND rm.bloqueante AND rm.periodo @> $2::timestamptz
         LEFT JOIN reservas r ON r.id = rm.reserva_id
         LEFT JOIN clientes cl ON cl.id = r.cliente_id
        WHERE s.tenant_id = $1 AND s.activo
        ORDER BY s.orden, m.nombre`,
      [tenantId, momento],
    );

    const salones = new Map<string, SalonEnPlano>();
    for (const f of rows) {
      let salon = salones.get(f.salon_id);
      if (!salon) {
        salon = { id: f.salon_id, nombre: f.salon, mesas: [] };
        salones.set(f.salon_id, salon);
      }
      salon.mesas.push({
        id: f.id,
        nombre: f.nombre,
        capacidadBase: f.capacidad_base,
        cabeceras: f.cabeceras,
        x: f.x,
        y: f.y,
        ocupadaPor: f.reserva_id
          ? {
              reservaId: f.reserva_id,
              cliente: f.cliente,
              personas: f.personas,
              estado: f.estado,
            }
          : null,
      });
    }
    return [...salones.values()];
  });
}

export interface HistorialDeReserva {
  tipo: string;
  actor: string;
  en: Date;
  datos: Record<string, unknown>;
}

/** Quién tocó qué y cuándo. Responde "¿quién movió a los Pérez de la 4 a la 12?". */
export async function historial(
  pool: pg.Pool,
  tenantId: string,
  reservaId: string,
): Promise<HistorialDeReserva[]> {
  return conTenant(pool, tenantId, async (c) => {
    const { rows } = await c.query(
      `SELECT e.tipo, e.actor_tipo, e.en, e.datos, u.nombre AS actor_nombre
         FROM reservas_eventos e
         LEFT JOIN usuarios u ON u.id = e.actor_id
        WHERE e.reserva_id = $1 ORDER BY e.id`,
      [reservaId],
    );
    return rows.map((f) => ({
      tipo: f.tipo,
      actor: f.actor_nombre ?? f.actor_tipo,
      en: f.en,
      datos: f.datos,
    }));
  });
}
