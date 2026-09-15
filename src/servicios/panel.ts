import type pg from 'pg';
import { conTenant } from '../datos/conexion';
import type { FormaMesa } from '../dominio/tipos';
import { horasDeApertura } from '../dominio/agenda';
import { cargarConfigTurnos, cargarTenant } from '../datos/repositorios';

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
 * El día se calcula en hora local y no en UTC: en UTC, una reserva de las 22:00 en
 * Buenos Aires ya cae al día siguiente y la planilla del martes aparecería vacía.
 *
 * Agrupa por día de ALMANAQUE, no por día de servicio: la reserva de la 01:00 del
 * domingo sale en la planilla del domingo, aunque para el bar sea la noche del sábado.
 * Está pendiente decidir si conviene al revés —ver docs/05-preguntas-abiertas.md—; si
 * cambia, tiene que cambiar junto con `ingresosPorBloque` y con las horas del plano,
 * porque las tres tienen que contar el día igual.
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
  /** Para dibujarla con su forma real: de acá sale el tamaño en el plano. */
  forma: FormaMesa;
  /**
   * Todo lo que tiene esta mesa alrededor de ese momento, no solo lo de ese instante.
   *
   * Una mesa puede estar libre a las 21:00 y tomada a las 21:15. Sin esto el plano la
   * ofrece para mover una reserva de las 20:30, el staff la elige, y recién ahí la base
   * rechaza el movimiento. Con esto directamente no se ofrece.
   */
  ocupaciones: { reservaId: string; desde: Date; hasta: Date }[];
  ocupadaPor: {
    reservaId: string;
    cliente: string | null;
    personas: number;
    estado: string;
    inicio: Date;
    /** Las otras mesas de la misma reserva, cuando está armada con varias. */
    conMesas: string[];
  } | null;
}

export interface SalonEnPlano {
  id: string;
  nombre: string;
  anchoCm: number;
  altoCm: number;
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
      `SELECT s.id AS salon_id, s.nombre AS salon, s.ancho_cm, s.alto_cm,
              m.id, m.nombre, m.capacidad_base, m.cabeceras, m.x, m.y, m.forma,
              r.id AS reserva_id, r.personas, r.estado, r.inicio, cl.nombre AS cliente,
              -- Las otras mesas de la misma reserva: sin esto, mover una mesa de un
              -- combo de tres parece mover la reserva entera y deja las otras dos.
              (SELECT array_agg(m2.nombre ORDER BY m2.nombre)
                 FROM reservas_mesas rm2 JOIN mesas m2 ON m2.id = rm2.mesa_id
                WHERE rm2.reserva_id = r.id AND m2.id <> m.id) AS con_mesas
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

    // Las ocupaciones del turno entero, en una sola consulta para todo el salón.
    const { rows: periodos } = await c.query(
      `SELECT rm.mesa_id, rm.reserva_id,
              lower(rm.periodo) AS desde, upper(rm.periodo) AS hasta
         FROM reservas_mesas rm
        WHERE rm.tenant_id = $1 AND rm.bloqueante
          AND rm.periodo && tstzrange($2::timestamptz - interval '8 hours',
                                      $2::timestamptz + interval '8 hours')`,
      [tenantId, momento],
    );
    const porMesa = new Map<string, MesaEnPlano['ocupaciones']>();
    for (const f of periodos) {
      const lista = porMesa.get(f.mesa_id) ?? [];
      lista.push({ reservaId: f.reserva_id, desde: f.desde, hasta: f.hasta });
      porMesa.set(f.mesa_id, lista);
    }

    const salones = new Map<string, SalonEnPlano>();
    for (const f of rows) {
      let salon = salones.get(f.salon_id);
      if (!salon) {
        salon = {
          id: f.salon_id,
          nombre: f.salon,
          anchoCm: f.ancho_cm,
          altoCm: f.alto_cm,
          mesas: [],
        };
        salones.set(f.salon_id, salon);
      }
      salon.mesas.push({
        id: f.id,
        nombre: f.nombre,
        capacidadBase: f.capacidad_base,
        cabeceras: f.cabeceras,
        x: f.x,
        y: f.y,
        forma: f.forma,
        ocupaciones: porMesa.get(f.id) ?? [],
        ocupadaPor: f.reserva_id
          ? {
              reservaId: f.reserva_id,
              cliente: f.cliente,
              personas: f.personas,
              estado: f.estado,
              inicio: f.inicio,
              conMesas: (f.con_mesas ?? []) as string[],
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

/**
 * Las horas a las que se puede mirar el salón ese día, según el horario del local.
 *
 * Estaban fijas en la pantalla (13:00, 20:30, 21:00…). Para un local que abre 19:30 y
 * cierra 02:00 eso significaba no poder ver nunca el salón después de las 23:00: una
 * reserva de las 23:30 figuraba en la planilla y no aparecía en el plano por ningún
 * lado. Ahora salen de las franjas de servicio configuradas.
 */
export async function horasDelPlano(
  pool: pg.Pool,
  tenantId: string,
  fecha: string,
): Promise<string[]> {
  return conTenant(pool, tenantId, async (c) => {
    const tenant = await cargarTenant(c, tenantId);
    return horasDeApertura(fecha, await cargarConfigTurnos(c, tenant));
  });
}
