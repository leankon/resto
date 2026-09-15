import type pg from 'pg';
import type { ParVetado } from '../dominio/combinaciones.js';
import type {
  ConfigAsignacion,
  DiaSemana,
  FranjaServicio,
  Mesa,
  Ocupacion,
  ReglaDuracion,
} from '../dominio/tipos.js';
import { CONFIG_POR_DEFECTO } from '../dominio/tipos.js';
import type { ConfigTurnos } from '../dominio/turnos.js';

export interface DatosTenant {
  id: string;
  slug: string;
  nombre: string;
  tz: string;
  pais: string;
}

export async function cargarTenant(c: pg.PoolClient, tenantId: string): Promise<DatosTenant> {
  const { rows } = await c.query(
    `SELECT id, slug, nombre, tz, pais FROM tenants WHERE id = $1`,
    [tenantId],
  );
  const fila = rows[0];
  if (!fila) throw new Error(`Tenant inexistente o fuera de alcance: ${tenantId}`);
  return fila as DatosTenant;
}

/** Las posiciones son entrada del motor desde D7, no decoración del panel. */
export async function cargarPlano(c: pg.PoolClient, tenantId: string): Promise<Mesa[]> {
  const { rows } = await c.query(
    `SELECT m.id, m.salon_id, m.nombre, m.capacidad_base, m.cabeceras,
            m.capacidad_min, m.x, m.y, m.combinable, m.activa
       FROM mesas m JOIN salones s ON s.id = m.salon_id
      WHERE m.tenant_id = $1 AND s.activo
      ORDER BY s.orden, m.nombre`,
    [tenantId],
  );
  return rows.map((f) => ({
    id: f.id,
    salonId: f.salon_id,
    nombre: f.nombre,
    capacidadBase: f.capacidad_base,
    cabeceras: f.cabeceras,
    capacidadMin: f.capacidad_min,
    x: f.x,
    y: f.y,
    combinable: f.combinable,
    activa: f.activa,
  }));
}

export async function cargarVetados(c: pg.PoolClient, tenantId: string): Promise<ParVetado[]> {
  const { rows } = await c.query(
    `SELECT mesa_a_id, mesa_b_id FROM combinaciones_vetadas WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows.map((f) => [f.mesa_a_id, f.mesa_b_id] as ParVetado);
}

export async function cargarConfigTurnos(
  c: pg.PoolClient,
  tenant: DatosTenant,
): Promise<ConfigTurnos> {
  const franjas = await c.query(
    `SELECT id, nombre, dias, desde, hasta, ultimo_ingreso
       FROM franjas_servicio WHERE tenant_id = $1 AND activa ORDER BY desde`,
    [tenant.id],
  );
  const reglas = await c.query(
    `SELECT franja_id, personas_min, personas_max, duracion_min, buffer_min
       FROM duraciones_turno WHERE tenant_id = $1
      ORDER BY franja_id NULLS LAST, personas_min`,
    [tenant.id],
  );

  // Postgres devuelve `time` como "HH:MM:SS"; el dominio trabaja con "HH:MM".
  const hhmm = (valor: string) => valor.slice(0, 5);

  return {
    tz: tenant.tz,
    franjas: franjas.rows.map(
      (f): FranjaServicio => ({
        id: f.id,
        nombre: f.nombre,
        dias: f.dias as DiaSemana[],
        desde: hhmm(f.desde),
        hasta: hhmm(f.hasta),
        ultimoIngreso: hhmm(f.ultimo_ingreso),
      }),
    ),
    reglas: reglas.rows.map(
      (f): ReglaDuracion => ({
        franjaId: f.franja_id,
        personasMin: f.personas_min,
        personasMax: f.personas_max,
        duracionMin: f.duracion_min,
        bufferMin: f.buffer_min,
      }),
    ),
    duracionPorDefecto: 120,
    bufferPorDefecto: 15,
  };
}

/** Lo que el local haya tocado pisa el default; lo que no, queda como viene. */
export async function cargarConfigAsignacion(
  c: pg.PoolClient,
  tenantId: string,
): Promise<ConfigAsignacion> {
  const { rows } = await c.query(`SELECT config FROM tenants WHERE id = $1`, [tenantId]);
  const propia = (rows[0]?.config?.asignacion ?? {}) as Partial<ConfigAsignacion>;
  return {
    ...CONFIG_POR_DEFECTO,
    ...propia,
    pesos: { ...CONFIG_POR_DEFECTO.pesos, ...(propia.pesos ?? {}) },
  };
}

/**
 * Todo lo que ocupa una mesa en la ventana pedida: reservas vigentes, walk-ins,
 * holds de lista de espera y mesas fuera de servicio.
 *
 * Los bloqueos entran por la misma puerta que las reservas: para el motor, una mesa
 * en mantenimiento y una mesa con gente son lo mismo.
 */
export async function cargarOcupaciones(
  c: pg.PoolClient,
  tenantId: string,
  desde: Date,
  hasta: Date,
): Promise<Ocupacion[]> {
  const ventana = `[${desde.toISOString()},${hasta.toISOString()})`;
  const { rows } = await c.query(
    `SELECT mesa_id, reserva_id::text AS ref, lower(periodo) AS desde, upper(periodo) AS hasta
       FROM reservas_mesas
      WHERE tenant_id = $1 AND bloqueante AND periodo && $2::tstzrange
      UNION ALL
     SELECT mesa_id, 'bloqueo:' || id::text, lower(periodo), upper(periodo)
       FROM bloqueos
      WHERE tenant_id = $1 AND periodo && $2::tstzrange`,
    [tenantId, ventana],
  );
  return rows.map((f) => ({
    mesaId: f.mesa_id,
    reservaId: f.ref,
    periodo: { desde: f.desde, hasta: f.hasta },
  }));
}

export interface ClienteGuardado {
  id: string;
  nombre: string;
  telefonoE164: string | null;
  email: string | null;
  visitas: number;
  noShows: number;
  esNuevo: boolean;
}

/**
 * Busca al cliente por su clave de contacto dentro del local; si no está, lo crea.
 *
 * El historial es por local y no se cruza entre tenants (lo garantiza RLS). El cliente
 * nunca crea una cuenta: su identidad es el teléfono que dejó al reservar.
 *
 * El upsert va contra el índice único, no contra un SELECT previo: dos reservas
 * simultáneas del mismo comensal no pueden crear dos filas.
 */
export async function buscarOCrearCliente(
  c: pg.PoolClient,
  tenantId: string,
  identidad:
    | { tipo: 'telefono'; clave: string; e164: string; email: string | null; nombre: string }
    | { tipo: 'email'; email: string; nombre: string },
): Promise<ClienteGuardado> {
  const porTelefono = identidad.tipo === 'telefono';
  const { rows } = await c.query(
    porTelefono
      ? `INSERT INTO clientes (tenant_id, telefono_e164, telefono_clave, email, nombre)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, telefono_clave) WHERE telefono_clave IS NOT NULL
         DO UPDATE SET nombre = EXCLUDED.nombre,
                       email = COALESCE(EXCLUDED.email, clientes.email),
                       actualizado_en = now()
         RETURNING id, nombre, telefono_e164, email, visitas, no_shows,
                   (xmax = 0) AS es_nuevo`
      : `INSERT INTO clientes (tenant_id, email, nombre)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, lower(email)) WHERE email IS NOT NULL
         DO UPDATE SET nombre = EXCLUDED.nombre, actualizado_en = now()
         RETURNING id, nombre, telefono_e164, email, visitas, no_shows,
                   (xmax = 0) AS es_nuevo`,
    porTelefono
      ? [tenantId, identidad.e164, identidad.clave, identidad.email, identidad.nombre]
      : [tenantId, identidad.email, identidad.nombre],
  );
  const f = rows[0];
  return {
    id: f.id,
    nombre: f.nombre,
    telefonoE164: f.telefono_e164,
    email: f.email,
    visitas: f.visitas,
    noShows: f.no_shows,
    esNuevo: f.es_nuevo,
  };
}

export interface Actor {
  tipo: 'cliente' | 'staff' | 'sistema' | 'admin_plataforma';
  id?: string | null;
}

export async function registrarEvento(
  c: pg.PoolClient,
  tenantId: string,
  reservaId: string,
  tipo: string,
  actor: Actor,
  datos: Record<string, unknown> = {},
  correlacionId?: string,
): Promise<void> {
  await c.query(
    `INSERT INTO reservas_eventos
       (tenant_id, reserva_id, tipo, actor_tipo, actor_id, correlacion_id, datos)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, reservaId, tipo, actor.tipo, actor.id ?? null, correlacionId ?? null, datos],
  );
}

export async function registrarAsignacion(
  c: pg.PoolClient,
  tenantId: string,
  reservaId: string | null,
  versionAlgoritmo: string,
  explicacion: unknown,
): Promise<void> {
  await c.query(
    `INSERT INTO asignaciones_log (tenant_id, reserva_id, version_algoritmo, explicacion)
     VALUES ($1, $2, $3, $4)`,
    [tenantId, reservaId, versionAlgoritmo, explicacion],
  );
}
