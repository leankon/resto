import type pg from 'pg';
import { conTenant } from '../datos/conexion';
import { aMinutos } from '../dominio/tiempo';
import type { DiaSemana } from '../dominio/tipos';

/**
 * Horarios de servicio, duración de los turnos y excepciones del calendario.
 *
 * Sin esto un local nuevo hereda el horario del ejemplo (almuerzo 12–16, cena 20–02) y
 * no hay forma de cambiarlo sin entrar a la base: el sistema acepta reservas a horas en
 * las que el local está cerrado y las rechaza a horas en las que está abierto.
 */

export interface FranjaConfigurada {
  id: string;
  nombre: string;
  dias: DiaSemana[];
  desde: string;
  hasta: string;
  ultimoIngreso: string;
  activa: boolean;
  /** true si cierra después de medianoche. Se muestra porque sorprende. */
  cruzaMedianoche: boolean;
}

export interface DuracionConfigurada {
  id: string;
  franjaId: string | null;
  franjaNombre: string | null;
  personasMin: number;
  personasMax: number;
  duracionMin: number;
  bufferMin: number;
}

export interface ExcepcionConfigurada {
  id: string;
  fecha: string;
  cerrado: boolean;
  desde: string | null;
  hasta: string | null;
  motivo: string | null;
}

export interface ConfiguracionDelLocal {
  nombre: string;
  tz: string;
  franjas: FranjaConfigurada[];
  duraciones: DuracionConfigurada[];
  excepciones: ExcepcionConfigurada[];
}

const hhmm = (valor: string) => valor.slice(0, 5);

export async function cargarConfiguracion(
  pool: pg.Pool,
  tenantId: string,
): Promise<ConfiguracionDelLocal> {
  return conTenant(pool, tenantId, async (c) => {
    const tenant = await c.query(`SELECT nombre, tz FROM tenants WHERE id = $1`, [tenantId]);
    const franjas = await c.query(
      `SELECT id, nombre, dias, desde, hasta, ultimo_ingreso, activa
         FROM franjas_servicio WHERE tenant_id = $1 ORDER BY desde`,
      [tenantId],
    );
    const duraciones = await c.query(
      `SELECT d.id, d.franja_id, f.nombre AS franja_nombre, d.personas_min, d.personas_max,
              d.duracion_min, d.buffer_min
         FROM duraciones_turno d
         LEFT JOIN franjas_servicio f ON f.id = d.franja_id
        WHERE d.tenant_id = $1
        ORDER BY f.desde NULLS LAST, d.personas_min`,
      [tenantId],
    );
    const excepciones = await c.query(
      `SELECT id, to_char(fecha, 'YYYY-MM-DD') AS fecha, cerrado, desde, hasta, motivo
         FROM excepciones_calendario
        WHERE tenant_id = $1 AND fecha >= current_date - 7
        ORDER BY fecha`,
      [tenantId],
    );

    return {
      nombre: tenant.rows[0]?.nombre ?? '',
      tz: tenant.rows[0]?.tz ?? '',
      franjas: franjas.rows.map((f) => ({
        id: f.id,
        nombre: f.nombre,
        dias: f.dias as DiaSemana[],
        desde: hhmm(f.desde),
        hasta: hhmm(f.hasta),
        ultimoIngreso: hhmm(f.ultimo_ingreso),
        activa: f.activa,
        cruzaMedianoche: aMinutos(hhmm(f.hasta)) <= aMinutos(hhmm(f.desde)),
      })),
      duraciones: duraciones.rows.map((d) => ({
        id: d.id,
        franjaId: d.franja_id,
        franjaNombre: d.franja_nombre,
        personasMin: d.personas_min,
        personasMax: d.personas_max,
        duracionMin: d.duracion_min,
        bufferMin: d.buffer_min,
      })),
      excepciones: excepciones.rows.map((e) => ({
        id: e.id,
        fecha: e.fecha,
        cerrado: e.cerrado,
        desde: e.desde ? hhmm(e.desde) : null,
        hasta: e.hasta ? hhmm(e.hasta) : null,
        motivo: e.motivo,
      })),
    };
  });
}

export interface DatosFranja {
  nombre: string;
  dias: DiaSemana[];
  desde: string;
  hasta: string;
  ultimoIngreso: string;
}

export type ResultadoConfig = { tipo: 'ok' } | { tipo: 'invalido'; motivo: string };

function validarFranja(datos: DatosFranja): string | null {
  if (!datos.nombre.trim()) return 'La franja necesita un nombre.';
  if (datos.dias.length === 0) return 'Elegí al menos un día.';

  let horas: number[];
  try {
    horas = [datos.desde, datos.hasta, datos.ultimoIngreso].map(aMinutos);
  } catch {
    return 'Alguna de las horas no es válida.';
  }
  const [desde, hasta, ultimo] = horas as [number, number, number];
  if (desde === hasta) return 'La hora de apertura y la de cierre no pueden ser la misma.';

  // Con una franja que cruza medianoche, "después" no es simplemente "mayor".
  const cruza = hasta < desde;
  const dentro = cruza ? ultimo >= desde || ultimo <= hasta : ultimo >= desde && ultimo <= hasta;
  if (!dentro) return 'El último ingreso tiene que caer entre la apertura y el cierre.';
  return null;
}

export async function guardarFranja(
  pool: pg.Pool,
  tenantId: string,
  datos: DatosFranja,
  franjaId?: string,
): Promise<ResultadoConfig> {
  const error = validarFranja(datos);
  if (error) return { tipo: 'invalido', motivo: error };

  await conTenant(pool, tenantId, async (c) => {
    const valores = [
      datos.nombre.trim(), datos.dias, datos.desde, datos.hasta, datos.ultimoIngreso,
    ];
    if (franjaId) {
      await c.query(
        `UPDATE franjas_servicio SET nombre = $2, dias = $3::int[], desde = $4::time,
                hasta = $5::time, ultimo_ingreso = $6::time
          WHERE id = $1`,
        [franjaId, ...valores],
      );
    } else {
      await c.query(
        `INSERT INTO franjas_servicio
           (tenant_id, nombre, dias, desde, hasta, ultimo_ingreso)
         VALUES ($1, $2, $3::int[], $4::time, $5::time, $6::time)`,
        [tenantId, ...valores],
      );
    }
  });
  return { tipo: 'ok' };
}

export async function cambiarActivaFranja(
  pool: pg.Pool,
  tenantId: string,
  franjaId: string,
  activa: boolean,
): Promise<void> {
  await conTenant(pool, tenantId, (c) =>
    c.query(`UPDATE franjas_servicio SET activa = $2 WHERE id = $1`, [franjaId, activa]),
  );
}

export type ResultadoBorrarFranja =
  | { tipo: 'borrada' }
  | { tipo: 'es_la_ultima' }
  | { tipo: 'tiene_duraciones'; duraciones: number };

/**
 * Un local sin ninguna franja activa no acepta ninguna reserva, así que borrar la
 * última es una forma silenciosa de apagar el sistema.
 */
export async function borrarFranja(
  pool: pg.Pool,
  tenantId: string,
  franjaId: string,
): Promise<ResultadoBorrarFranja> {
  return conTenant(pool, tenantId, async (c) => {
    const quedan = await c.query(
      `SELECT count(*)::int AS n FROM franjas_servicio WHERE tenant_id = $1 AND id <> $2`,
      [tenantId, franjaId],
    );
    if (quedan.rows[0].n === 0) return { tipo: 'es_la_ultima' as const };

    await c.query(`DELETE FROM franjas_servicio WHERE id = $1`, [franjaId]);
    return { tipo: 'borrada' as const };
  });
}

export interface DatosDuracion {
  franjaId: string | null;
  personasMin: number;
  personasMax: number;
  duracionMin: number;
  bufferMin: number;
}

function validarDuracion(d: DatosDuracion): string | null {
  if (d.personasMin < 1 || d.personasMax < d.personasMin) {
    return 'El rango de personas está al revés o arranca en cero.';
  }
  if (d.duracionMin < 15 || d.duracionMin > 600) {
    return 'La duración tiene que estar entre 15 minutos y 10 horas.';
  }
  if (d.bufferMin < 0 || d.bufferMin > 120) {
    return 'El tiempo de limpieza tiene que estar entre 0 y 120 minutos.';
  }
  return null;
}

export async function guardarDuracion(
  pool: pg.Pool,
  tenantId: string,
  datos: DatosDuracion,
  duracionId?: string,
): Promise<ResultadoConfig> {
  const error = validarDuracion(datos);
  if (error) return { tipo: 'invalido', motivo: error };

  await conTenant(pool, tenantId, async (c) => {
    const valores = [
      datos.franjaId, datos.personasMin, datos.personasMax, datos.duracionMin, datos.bufferMin,
    ];
    if (duracionId) {
      await c.query(
        `UPDATE duraciones_turno SET franja_id = $2, personas_min = $3, personas_max = $4,
                duracion_min = $5, buffer_min = $6
          WHERE id = $1`,
        [duracionId, ...valores],
      );
    } else {
      await c.query(
        `INSERT INTO duraciones_turno
           (tenant_id, franja_id, personas_min, personas_max, duracion_min, buffer_min)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, ...valores],
      );
    }
  });
  return { tipo: 'ok' };
}

/**
 * Pone la misma duración en todas las reglas de turno de un golpe.
 *
 * Un local que trabaja con turnos de dos horas parejos tenía que editar doce filas de a
 * una para decirlo, y equivocarse en una sola deja un tamaño de grupo rotando distinto
 * sin que nadie lo note. Las reglas siguen existiendo y se pueden afinar después: esto
 * solo fija el punto de partida.
 */
export async function ponerDuracionPareja(
  pool: pg.Pool,
  tenantId: string,
  duracionMin: number,
  bufferMin: number,
): Promise<ResultadoConfig> {
  const error = validarDuracion({
    franjaId: null, personasMin: 1, personasMax: 1, duracionMin, bufferMin,
  });
  if (error) return { tipo: 'invalido', motivo: error };

  const { filas } = await conTenant(pool, tenantId, async (c) => {
    const { rowCount } = await c.query(
      `UPDATE duraciones_turno SET duracion_min = $2, buffer_min = $3 WHERE tenant_id = $1`,
      [tenantId, duracionMin, bufferMin],
    );
    return { filas: rowCount ?? 0 };
  });

  if (filas === 0) {
    return { tipo: 'invalido', motivo: 'Todavía no hay ninguna regla de turno que cambiar.' };
  }
  return { tipo: 'ok' };
}

export async function borrarDuracion(
  pool: pg.Pool,
  tenantId: string,
  duracionId: string,
): Promise<void> {
  await conTenant(pool, tenantId, (c) =>
    c.query(`DELETE FROM duraciones_turno WHERE id = $1`, [duracionId]),
  );
}

export interface DatosExcepcion {
  fecha: string;
  cerrado: boolean;
  desde?: string | null;
  hasta?: string | null;
  motivo?: string | null;
}

export async function guardarExcepcion(
  pool: pg.Pool,
  tenantId: string,
  datos: DatosExcepcion,
): Promise<ResultadoConfig> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)) {
    return { tipo: 'invalido', motivo: 'La fecha no es válida.' };
  }
  if (!datos.cerrado && !(datos.desde && datos.hasta)) {
    return {
      tipo: 'invalido',
      motivo: 'Si ese día abre, poné desde qué hora y hasta qué hora.',
    };
  }

  await conTenant(pool, tenantId, (c) =>
    c.query(
      `INSERT INTO excepciones_calendario (tenant_id, fecha, cerrado, desde, hasta, motivo)
       VALUES ($1, $2::date, $3, $4::time, $5::time, $6)
       ON CONFLICT (tenant_id, fecha) DO UPDATE
         SET cerrado = EXCLUDED.cerrado, desde = EXCLUDED.desde,
             hasta = EXCLUDED.hasta, motivo = EXCLUDED.motivo`,
      [
        tenantId, datos.fecha, datos.cerrado,
        datos.cerrado ? null : (datos.desde ?? null),
        datos.cerrado ? null : (datos.hasta ?? null),
        datos.motivo?.trim() || null,
      ],
    ),
  );
  return { tipo: 'ok' };
}

export async function borrarExcepcion(
  pool: pg.Pool,
  tenantId: string,
  excepcionId: string,
): Promise<void> {
  await conTenant(pool, tenantId, (c) =>
    c.query(`DELETE FROM excepciones_calendario WHERE id = $1`, [excepcionId]),
  );
}

export async function renombrarLocal(
  pool: pg.Pool,
  tenantId: string,
  nombre: string,
): Promise<ResultadoConfig> {
  if (!nombre.trim()) return { tipo: 'invalido', motivo: 'El local necesita un nombre.' };
  await conTenant(pool, tenantId, (c) =>
    c.query(`UPDATE tenants SET nombre = $2, actualizado_en = now() WHERE id = $1`,
      [tenantId, nombre.trim()]),
  );
  return { tipo: 'ok' };
}

export interface DatosPublicos {
  webPublica: boolean;
  direccion: string;
  telefonoPublico: string;
  descripcion: string;
  anticipacionMin: number;
  diasMaxAnticipacion: number;
  personasMaxWeb: number;
  cancelacionMin: number;
  mensajeConfirmacion: string;
}

export async function cargarDatosPublicos(
  pool: pg.Pool,
  tenantId: string,
): Promise<DatosPublicos & { slug: string }> {
  return conTenant(pool, tenantId, async (c) => {
    const { rows } = await c.query(
      `SELECT slug, web_publica, direccion, telefono_publico, descripcion,
              anticipacion_min, dias_max_anticipacion, personas_max_web,
              cancelacion_min, mensaje_confirmacion
         FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const f = rows[0];
    return {
      slug: f.slug,
      webPublica: f.web_publica,
      direccion: f.direccion ?? '',
      telefonoPublico: f.telefono_publico ?? '',
      descripcion: f.descripcion ?? '',
      anticipacionMin: f.anticipacion_min,
      diasMaxAnticipacion: f.dias_max_anticipacion,
      personasMaxWeb: f.personas_max_web,
      cancelacionMin: f.cancelacion_min,
      mensajeConfirmacion: f.mensaje_confirmacion ?? '',
    };
  });
}

/**
 * Guarda lo que el local muestra y acepta de cara al público.
 *
 * Los límites se validan acá además de en la base: un CHECK rechazando la escritura le
 * muestra al dueño un error de Postgres, no una explicación.
 */
export async function guardarDatosPublicos(
  pool: pg.Pool,
  tenantId: string,
  datos: DatosPublicos,
): Promise<ResultadoConfig> {
  const entero = (valor: number, min: number, max: number, campo: string) => {
    if (!Number.isInteger(valor) || valor < min || valor > max) {
      return `${campo} tiene que ser un número entre ${min} y ${max}.`;
    }
    return null;
  };
  const motivo =
    entero(datos.anticipacionMin, 0, 43200, 'La anticipación mínima') ??
    entero(datos.diasMaxAnticipacion, 1, 365, 'El plazo máximo') ??
    entero(datos.personasMaxWeb, 1, 100, 'El grupo más grande') ??
    entero(datos.cancelacionMin, 0, 43200, 'El plazo para cancelar');
  if (motivo) return { tipo: 'invalido', motivo };

  const vacioEsNulo = (texto: string) => texto.trim() || null;

  await conTenant(pool, tenantId, (c) =>
    c.query(
      `UPDATE tenants
          SET web_publica = $2, direccion = $3, telefono_publico = $4, descripcion = $5,
              anticipacion_min = $6, dias_max_anticipacion = $7, personas_max_web = $8,
              cancelacion_min = $9, mensaje_confirmacion = $10, actualizado_en = now()
        WHERE id = $1`,
      [
        tenantId,
        datos.webPublica,
        vacioEsNulo(datos.direccion),
        vacioEsNulo(datos.telefonoPublico),
        vacioEsNulo(datos.descripcion),
        datos.anticipacionMin,
        datos.diasMaxAnticipacion,
        datos.personasMaxWeb,
        datos.cancelacionMin,
        vacioEsNulo(datos.mensajeConfirmacion),
      ],
    ),
  );
  return { tipo: 'ok' };
}
