import type pg from 'pg';
import {
  VERSION_ALGORITMO,
  asignar,
  buscarAlternativas,
  type Alternativa,
} from '../dominio/asignacion';
import { identificar, type DatosContacto } from '../dominio/clientes';
import { derivarCandidatos } from '../dominio/combinaciones';
import { fechaLocal, sumarMinutos } from '../dominio/tiempo';
import { resolverTurno } from '../dominio/turnos';
import { conTenant, esSolape, lockDelDia } from '../datos/conexion';
import {
  buscarOCrearCliente,
  cargarConfigAsignacion,
  cargarConfigTurnos,
  cargarOcupaciones,
  cargarPlano,
  cargarTenant,
  cargarVetados,
  registrarAsignacion,
  registrarEvento,
  type Actor,
  type ClienteGuardado,
} from '../datos/repositorios';

/** Margen alrededor del turno: cubre el buffer y la búsqueda de horarios alternativos. */
const VENTANA_HORAS = 8;

export type CanalOrigen = 'web' | 'widget' | 'whatsapp' | 'manual';

export interface PedidoDeReserva {
  tenantId: string;
  inicio: Date;
  personas: number;
  contacto: DatosContacto;
  canalOrigen: CanalOrigen;
  salonPreferido?: string;
  notas?: string;
  actor: Actor;
}

export interface MesaAsignada {
  id: string;
  nombre: string;
}

export type ResultadoReserva =
  | {
      tipo: 'creada';
      reservaId: string;
      mesas: MesaAsignada[];
      cliente: ClienteGuardado;
      cabecerasUsadas: number;
      duracionMin: number;
    }
  | { tipo: 'fuera_de_servicio' }
  | { tipo: 'despues_del_ultimo_ingreso'; franjaNombre: string; ultimoIngreso: string }
  | { tipo: 'sin_contacto' }
  | { tipo: 'sin_lugar'; alternativas: Alternativa[] };

/**
 * Crea una reserva de punta a punta: resuelve el turno, asigna mesa, identifica al
 * cliente y deja el rastro. Todo en una transacción.
 *
 * Es el mismo camino para web, widget, WhatsApp y carga manual del panel: si una
 * reserva de WhatsApp se comportara distinto a una de la web, el panel mostraría dos
 * realidades. El único parámetro que cambia es `canalOrigen`.
 */
export async function crearReserva(
  pool: pg.Pool,
  pedido: PedidoDeReserva,
): Promise<ResultadoReserva> {
  return conReintentoPorSolape(() =>
    conTenant(pool, pedido.tenantId, async (c) => {
      const tenant = await cargarTenant(c, pedido.tenantId);
      await lockDelDia(c, tenant.id, fechaLocal(pedido.inicio, tenant.tz));

      const turno = resolverTurno(
        pedido.inicio,
        pedido.personas,
        await cargarConfigTurnos(c, tenant),
      );
      if (turno.tipo !== 'ok') return turno;

      const identidad = identificar(pedido.contacto, tenant.pais);
      if (identidad.tipo === 'sin_contacto') return { tipo: 'sin_contacto' as const };

      const config = await cargarConfigAsignacion(c, tenant.id);
      const candidatos = derivarCandidatos(
        await cargarPlano(c, tenant.id),
        config,
        await cargarVetados(c, tenant.id),
      );
      const ocupaciones = await cargarOcupaciones(
        c,
        tenant.id,
        sumarMinutos(pedido.inicio, -VENTANA_HORAS * 60),
        sumarMinutos(pedido.inicio, VENTANA_HORAS * 60),
      );

      const solicitud = {
        inicio: pedido.inicio,
        personas: pedido.personas,
        duracionMin: turno.duracionMin,
        bufferMin: turno.bufferMin,
        ...(pedido.salonPreferido ? { salonPreferido: pedido.salonPreferido } : {}),
      };
      const resultado = asignar(candidatos, ocupaciones, solicitud, config);

      if (resultado.tipo === 'sin_lugar') {
        // Se guarda igual: saber por qué se rechazó una reserva es tan útil como
        // saber por qué se aceptó otra.
        await registrarAsignacion(c, tenant.id, null, VERSION_ALGORITMO, resultado.log);
        return {
          tipo: 'sin_lugar' as const,
          alternativas: buscarAlternativas(candidatos, ocupaciones, solicitud, config),
        };
      }

      const cliente = await buscarOCrearCliente(c, tenant.id, identidad);

      const { rows } = await c.query(
        `INSERT INTO reservas (tenant_id, cliente_id, inicio, duracion_min, buffer_min,
                               personas, canal_origen, notas, creada_por_usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          tenant.id,
          cliente.id,
          pedido.inicio,
          turno.duracionMin,
          turno.bufferMin,
          pedido.personas,
          pedido.canalOrigen,
          pedido.notas ?? null,
          pedido.actor.tipo === 'staff' ? (pedido.actor.id ?? null) : null,
        ],
      );
      const reservaId = rows[0].id as string;

      await ocuparMesas(c, tenant.id, reservaId, resultado.mesas.map((m) => m.id), resultado.periodo);

      await registrarEvento(c, tenant.id, reservaId, 'creada', pedido.actor, {
        canalOrigen: pedido.canalOrigen,
        personas: pedido.personas,
        clienteNuevo: cliente.esNuevo,
      });
      await registrarEvento(c, tenant.id, reservaId, 'asignada_auto', { tipo: 'sistema' }, {
        mesas: resultado.mesas.map((m) => m.nombre),
        cabecerasUsadas: resultado.cabecerasUsadas,
      });
      await registrarAsignacion(c, tenant.id, reservaId, VERSION_ALGORITMO, resultado.log);

      return {
        tipo: 'creada' as const,
        reservaId,
        mesas: resultado.mesas.map((m) => ({ id: m.id, nombre: m.nombre })),
        cliente,
        cabecerasUsadas: resultado.cabecerasUsadas,
        duracionMin: turno.duracionMin,
      };
    }),
  );
}

export interface PedidoWalkIn {
  tenantId: string;
  mesaIds: string[];
  personas: number;
  inicio?: Date;
  actor: Actor;
}

export type ResultadoWalkIn =
  | { tipo: 'ocupada'; reservaId: string }
  | { tipo: 'mesa_no_disponible' }
  | { tipo: 'fuera_de_servicio' };

/**
 * Marca una mesa como ocupada por gente que cayó sin reservar (D6).
 *
 * Es una reserva sin cliente en estado `sentada`, en la misma tabla y con la misma
 * constraint que todo lo demás. Sin esto el motor asigna mesas que físicamente están
 * ocupadas, y el error aparece con el cliente parado en la puerta.
 */
export async function ocuparMesa(
  pool: pg.Pool,
  pedido: PedidoWalkIn,
): Promise<ResultadoWalkIn> {
  const inicio = pedido.inicio ?? new Date();
  try {
    return await conTenant(pool, pedido.tenantId, async (c) => {
      const tenant = await cargarTenant(c, pedido.tenantId);
      await lockDelDia(c, tenant.id, fechaLocal(inicio, tenant.tz));

      const turno = resolverTurno(inicio, pedido.personas, await cargarConfigTurnos(c, tenant));
      // Un walk-in fuera de horario igual se registra: la gente ya está sentada.
      const duracionMin = turno.tipo === 'ok' ? turno.duracionMin : 120;
      const bufferMin = turno.tipo === 'ok' ? turno.bufferMin : 15;

      const { rows } = await c.query(
        `INSERT INTO reservas (tenant_id, cliente_id, inicio, duracion_min, buffer_min,
                               personas, canal_origen, estado, creada_por_usuario_id)
         VALUES ($1, NULL, $2, $3, $4, $5, 'walk_in', 'sentada', $6) RETURNING id`,
        [tenant.id, inicio, duracionMin, bufferMin, pedido.personas, pedido.actor.id ?? null],
      );
      const reservaId = rows[0].id as string;

      await ocuparMesas(c, tenant.id, reservaId, pedido.mesaIds, {
        desde: inicio,
        hasta: sumarMinutos(inicio, duracionMin + bufferMin),
      });
      await registrarEvento(c, tenant.id, reservaId, 'walk_in', pedido.actor, {
        personas: pedido.personas,
      });

      return { tipo: 'ocupada' as const, reservaId };
    });
  } catch (error) {
    if (esSolape(error)) return { tipo: 'mesa_no_disponible' };
    throw error;
  }
}

export type ResultadoReasignacion =
  | { tipo: 'reasignada'; antes: string[]; despues: string[] }
  | { tipo: 'mesa_ocupada' }
  | { tipo: 'reserva_inexistente' };

/**
 * Mueve una reserva a otras mesas por decisión del staff.
 *
 * Marca las mesas nuevas como `fijada_manualmente`: a partir de acá el re-optimizador
 * automático no las toca (D2). Una decisión humana nunca es pisada por el sistema, y
 * queda registrada con quién la tomó.
 */
export async function reasignarMesa(
  pool: pg.Pool,
  entrada: {
    tenantId: string;
    reservaId: string;
    mesaIds: string[];
    motivo?: string;
    actor: Actor;
    correlacionId?: string;
  },
): Promise<ResultadoReasignacion> {
  try {
    return await conTenant(pool, entrada.tenantId, async (c) => {
      const reserva = await c.query(
        `SELECT inicio, duracion_min, buffer_min FROM reservas WHERE id = $1`,
        [entrada.reservaId],
      );
      if (!reserva.rows[0]) return { tipo: 'reserva_inexistente' as const };

      const tenant = await cargarTenant(c, entrada.tenantId);
      await lockDelDia(c, tenant.id, fechaLocal(reserva.rows[0].inicio, tenant.tz));

      const previas = await c.query(
        `SELECT m.nombre FROM reservas_mesas rm JOIN mesas m ON m.id = rm.mesa_id
          WHERE rm.reserva_id = $1 ORDER BY m.nombre`,
        [entrada.reservaId],
      );
      const antes = previas.rows.map((f) => f.nombre as string);

      await c.query(`DELETE FROM reservas_mesas WHERE reserva_id = $1`, [entrada.reservaId]);

      const { inicio, duracion_min, buffer_min } = reserva.rows[0];
      const nombres = await ocuparMesas(
        c,
        tenant.id,
        entrada.reservaId,
        entrada.mesaIds,
        { desde: inicio, hasta: sumarMinutos(inicio, duracion_min + buffer_min) },
        true,
      );

      await registrarEvento(
        c,
        tenant.id,
        entrada.reservaId,
        'reasignada_manual',
        entrada.actor,
        { antes, despues: nombres, motivo: entrada.motivo ?? null },
        entrada.correlacionId,
      );
      return { tipo: 'reasignada' as const, antes, despues: nombres };
    });
  } catch (error) {
    if (esSolape(error)) return { tipo: 'mesa_ocupada' };
    throw error;
  }
}

export type EstadoReserva =
  | 'confirmada'
  | 'sentada'
  | 'finalizada'
  | 'cancelada'
  | 'no_show'
  | 'en_riesgo';

/**
 * Cambia el estado de una reserva y actualiza el historial del cliente.
 *
 * `finalizada` achica el periodo hasta ahora en vez de liberar la mesa entera: los
 * minutos que sobraron vuelven al inventario y se le pueden vender a la lista de
 * espera, sin borrar el hecho de que la mesa estuvo ocupada.
 */
export async function cambiarEstado(
  pool: pg.Pool,
  entrada: { tenantId: string; reservaId: string; estado: EstadoReserva; actor: Actor },
): Promise<{ tipo: 'actualizada' } | { tipo: 'reserva_inexistente' }> {
  return conTenant(pool, entrada.tenantId, async (c) => {
    const { rows } = await c.query(
      `UPDATE reservas SET estado = $2, actualizado_en = now()
        WHERE id = $1 RETURNING cliente_id, estado, buffer_min`,
      [entrada.reservaId, entrada.estado],
    );
    const reserva = rows[0];
    if (!reserva) return { tipo: 'reserva_inexistente' as const };

    if (entrada.estado === 'finalizada') {
      // `greatest` con el inicio no es defensivo porque sí: finalizar una reserva que
      // todavía no empezó daría un rango con el fin antes del principio y Postgres
      // rechaza eso con un error. Así, el rango queda vacío y la mesa se libera, que
      // es lo que quiso decir quien apretó el botón.
      await c.query(
        `UPDATE reservas_mesas
            SET periodo = tstzrange(
                  lower(periodo),
                  greatest(lower(periodo),
                           least(upper(periodo), now() + ($2 || ' minutes')::interval)),
                  '[)')
          WHERE reserva_id = $1 AND upper(periodo) > now()`,
        [entrada.reservaId, reserva.buffer_min],
      );
    }

    if (reserva.cliente_id) {
      const columna = { sentada: 'visitas', no_show: 'no_shows', cancelada: 'cancelaciones' }[
        entrada.estado as string
      ];
      if (columna) {
        await c.query(
          `UPDATE clientes
              SET ${columna} = ${columna} + 1,
                  ultima_visita_en = CASE WHEN $2 THEN now() ELSE ultima_visita_en END,
                  actualizado_en = now()
            WHERE id = $1`,
          [reserva.cliente_id, entrada.estado === 'sentada'],
        );
      }
    }

    await registrarEvento(c, entrada.tenantId, entrada.reservaId, entrada.estado, entrada.actor);
    return { tipo: 'actualizada' as const };
  });
}

/** Inserta el inventario de una reserva y devuelve los nombres de mesa ocupados. */
async function ocuparMesas(
  c: pg.PoolClient,
  tenantId: string,
  reservaId: string,
  mesaIds: string[],
  periodo: { desde: Date; hasta: Date },
  fijadaManualmente = false,
): Promise<string[]> {
  const rango = `[${periodo.desde.toISOString()},${periodo.hasta.toISOString()})`;
  const { rows } = await c.query(
    `INSERT INTO reservas_mesas (tenant_id, reserva_id, mesa_id, periodo, fijada_manualmente)
     SELECT $1, $2, id, $4::tstzrange, $5 FROM mesas WHERE id = ANY($3::uuid[])
     RETURNING (SELECT nombre FROM mesas WHERE mesas.id = reservas_mesas.mesa_id)`,
    [tenantId, reservaId, mesaIds, rango, fijadaManualmente],
  );
  if (rows.length !== mesaIds.length) {
    throw new Error('Alguna mesa no existe o pertenece a otro local');
  }
  return rows.map((f) => f.nombre as string).sort();
}

/**
 * El advisory lock serializa el camino normal, pero algo puede entrar sin pasar por él
 * (un script, una migración, un bug futuro). Si la constraint rechaza, se recalcula:
 * volver a correr el motor con el estado nuevo es más correcto que insistir con una
 * decisión que ya quedó vieja.
 */
async function conReintentoPorSolape<T>(fn: () => Promise<T>, intentos = 3): Promise<T> {
  for (let intento = 1; ; intento++) {
    try {
      return await fn();
    } catch (error) {
      if (!esSolape(error) || intento >= intentos) throw error;
    }
  }
}
