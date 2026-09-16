import type pg from 'pg';
import { horariosDelDia, type Horario } from '../dominio/agenda';
import { asignar } from '../dominio/asignacion';
import type { DatosContacto } from '../dominio/clientes';
import { derivarCandidatos } from '../dominio/combinaciones';
import { generarToken, hashearToken } from '../dominio/passwords';
import { fechaLocal, hoyEn, sumarDias, sumarMinutos } from '../dominio/tiempo';
import { conTenant } from '../datos/conexion';
import {
  cargarConfigAsignacion,
  cargarConfigTurnos,
  cargarOcupaciones,
  cargarPlano,
  cargarTenant,
  cargarVetados,
  registrarEvento,
} from '../datos/repositorios';
import { crearReserva, type CanalOrigen, type ResultadoReserva } from './reservas';

/**
 * El local visto desde afuera: lo que se muestra en su página y las reglas con las que
 * acepta reservas de gente que no conoce.
 */
export interface LocalPublico {
  id: string;
  slug: string;
  nombre: string;
  tz: string;
  pais: string;
  webPublica: boolean;
  direccion: string | null;
  telefonoPublico: string | null;
  descripcion: string | null;
  anticipacionMin: number;
  diasMaxAnticipacion: number;
  personasMaxWeb: number;
  cancelacionMin: number;
  mensajeConfirmacion: string | null;
  /** Cada cuántos minutos se le ofrece un horario al cliente: 15, 30 o 60. */
  pasoReservaMin: number;
}

const COLUMNAS = `id, slug, nombre, tz, pais, web_publica, direccion, telefono_publico,
                  descripcion, anticipacion_min, dias_max_anticipacion, personas_max_web,
                  cancelacion_min, mensaje_confirmacion, paso_reserva_min`;

function aLocal(f: Record<string, unknown>): LocalPublico {
  return {
    id: f['id'] as string,
    slug: f['slug'] as string,
    nombre: f['nombre'] as string,
    tz: f['tz'] as string,
    pais: f['pais'] as string,
    webPublica: f['web_publica'] as boolean,
    direccion: (f['direccion'] as string) ?? null,
    telefonoPublico: (f['telefono_publico'] as string) ?? null,
    descripcion: (f['descripcion'] as string) ?? null,
    anticipacionMin: f['anticipacion_min'] as number,
    diasMaxAnticipacion: f['dias_max_anticipacion'] as number,
    personasMaxWeb: f['personas_max_web'] as number,
    cancelacionMin: f['cancelacion_min'] as number,
    mensajeConfirmacion: (f['mensaje_confirmacion'] as string) ?? null,
    pasoReservaMin: f['paso_reserva_min'] as number,
  };
}

/**
 * Encuentra el local por la dirección de su página.
 *
 * Mismo problema de orden que el login: hay que saber de qué local se trata ANTES de
 * poder fijar el tenant, así que no puede pasar por la conexión normal de la app. Va
 * por el rol de solo lectura, que sobre `tenants` es exactamente lo que necesita y no
 * puede leer una reserva ni un cliente.
 */
export async function localPorSlug(
  poolAuth: pg.Pool,
  slug: string,
): Promise<LocalPublico | null> {
  const { rows } = await poolAuth.query(
    `SELECT ${COLUMNAS} FROM tenants WHERE slug = $1 AND estado = 'activo'`,
    [slug],
  );
  return rows[0] ? aLocal(rows[0]) : null;
}

/** Un horario de la grilla, ya cruzado con el estado real de las mesas. */
export interface HorarioOfrecido {
  hora: string;
  inicio: Date;
  franjaNombre: string;
  hayLugar: boolean;
}

export interface Disponibilidad {
  fecha: string;
  personas: number;
  horarios: HorarioOfrecido[];
  /** Por qué no hay nada que ofrecer, cuando la lista viene vacía. */
  motivo: 'cerrado' | 'ya_paso' | 'sin_lugar' | null;
}

/** Ventana de ocupaciones a cargar: el día entero más el arrastre de la madrugada. */
const MARGEN_HORAS = 8;

/**
 * Qué horarios tienen lugar para un grupo, en un día.
 *
 * Corre el mismo motor que usa una reserva real, una vez por horario, pero cargando el
 * plano y las ocupaciones una sola vez para todo el día. Ofrecer un horario con un
 * criterio distinto al que después decide sería peor que no ofrecerlo: el cliente
 * elige, completa sus datos y recién ahí se entera de que no había lugar.
 */
export async function disponibilidad(
  pool: pg.Pool,
  local: LocalPublico,
  entrada: { fecha: string; personas: number; ahora?: Date },
): Promise<Disponibilidad> {
  const ahora = entrada.ahora ?? new Date();
  const vacia = (motivo: Disponibilidad['motivo']): Disponibilidad => ({
    fecha: entrada.fecha,
    personas: entrada.personas,
    horarios: [],
    motivo,
  });

  return conTenant(pool, local.id, async (c) => {
    const tenant = await cargarTenant(c, local.id);
    const config = await cargarConfigTurnos(c, tenant);
    const delDia = horariosDelDia(
      entrada.fecha,
      entrada.personas,
      config,
      local.pasoReservaMin,
    );
    if (delDia.length === 0) return vacia('cerrado');

    // Nadie reserva para dentro de diez minutos: la cocina se entera cuando la gente
    // ya está en la puerta.
    const desdeCuando = sumarMinutos(ahora, local.anticipacionMin);
    const aTiempo = delDia.filter((h) => h.inicio >= desdeCuando);
    if (aTiempo.length === 0) return vacia('ya_paso');

    const configAsignacion = await cargarConfigAsignacion(c, tenant.id);
    const candidatos = derivarCandidatos(
      await cargarPlano(c, tenant.id),
      configAsignacion,
      await cargarVetados(c, tenant.id),
    );
    const ocupaciones = await cargarOcupaciones(
      c,
      tenant.id,
      sumarMinutos(aTiempo[0]!.inicio, -MARGEN_HORAS * 60),
      sumarMinutos(aTiempo.at(-1)!.inicio, MARGEN_HORAS * 60),
    );

    const horarios = aTiempo.map((h: Horario) => ({
      hora: h.hora,
      inicio: h.inicio,
      franjaNombre: h.franjaNombre,
      hayLugar:
        asignar(
          candidatos,
          ocupaciones,
          {
            inicio: h.inicio,
            personas: entrada.personas,
            duracionMin: h.duracionMin,
            bufferMin: h.bufferMin,
          },
          configAsignacion,
        ).tipo !== 'sin_lugar',
    }));

    return {
      fecha: entrada.fecha,
      personas: entrada.personas,
      horarios,
      motivo: horarios.some((h) => h.hayLugar) ? null : 'sin_lugar',
    };
  });
}

export type ResultadoPublico =
  | { tipo: 'creada'; reservaId: string; token: string; inicio: Date; duracionMin: number }
  | { tipo: 'web_apagada' }
  | { tipo: 'grupo_muy_grande'; maximo: number }
  | { tipo: 'fuera_de_plazo'; diasMax: number }
  | { tipo: 'muy_sobre_la_hora'; anticipacionMin: number }
  | Exclude<ResultadoReserva, { tipo: 'creada' }>;

/**
 * Reserva desde la página pública o el widget.
 *
 * Es `crearReserva` con las reglas de cara al público adelante: no se confía en lo que
 * llega del navegador, ni siquiera en que la web esté prendida. Las mismas reglas que
 * filtran la grilla de horarios se revalidan acá, porque entre que se pintó la grilla
 * y se apretó el botón pasó tiempo y pudo entrar otra reserva.
 */
export async function reservarDesdeLaWeb(
  pool: pg.Pool,
  local: LocalPublico,
  pedido: {
    inicio: Date;
    personas: number;
    contacto: DatosContacto;
    notas?: string;
    canal?: Extract<CanalOrigen, 'web' | 'widget'>;
    ahora?: Date;
  },
): Promise<ResultadoPublico> {
  const ahora = pedido.ahora ?? new Date();

  if (!local.webPublica) return { tipo: 'web_apagada' };
  if (pedido.personas > local.personasMaxWeb) {
    return { tipo: 'grupo_muy_grande', maximo: local.personasMaxWeb };
  }
  if (pedido.inicio < sumarMinutos(ahora, local.anticipacionMin)) {
    return { tipo: 'muy_sobre_la_hora', anticipacionMin: local.anticipacionMin };
  }
  const ultimoDia = sumarDias(hoyEn(local.tz), local.diasMaxAnticipacion);
  if (fechaLocal(pedido.inicio, local.tz) > ultimoDia) {
    return { tipo: 'fuera_de_plazo', diasMax: local.diasMaxAnticipacion };
  }

  const token = generarToken();
  const resultado = await crearReserva(pool, {
    tenantId: local.id,
    inicio: pedido.inicio,
    personas: pedido.personas,
    contacto: pedido.contacto,
    canalOrigen: pedido.canal ?? 'web',
    actor: { tipo: 'cliente' },
    tokenHash: hashearToken(token),
    ...(pedido.notas ? { notas: pedido.notas } : {}),
  });

  if (resultado.tipo !== 'creada') return resultado;
  return {
    tipo: 'creada',
    reservaId: resultado.reservaId,
    token,
    inicio: pedido.inicio,
    duracionMin: resultado.duracionMin,
  };
}

export interface ReservaDelCliente {
  id: string;
  inicio: Date;
  personas: number;
  estado: string;
  notas: string | null;
  nombre: string;
  /** Si todavía está a tiempo de cancelarla sin llamar al local. */
  sePuedeCancelar: boolean;
}

/**
 * La reserva que hay detrás de un link de confirmación.
 *
 * El token es la credencial: quien lo tiene puede ver y cancelar esa reserva y ninguna
 * otra. Se busca por el hash, nunca por el token, y siempre dentro del local del link:
 * un token de un local no abre una reserva de otro.
 */
export async function reservaPorToken(
  pool: pg.Pool,
  local: LocalPublico,
  token: string,
  ahora = new Date(),
): Promise<ReservaDelCliente | null> {
  return conTenant(pool, local.id, async (c) => {
    const { rows } = await c.query(
      `SELECT r.id, r.inicio, r.personas, r.estado, r.notas, c.nombre
         FROM reservas r LEFT JOIN clientes c ON c.id = r.cliente_id
        WHERE r.token_hash = $1`,
      [hashearToken(token)],
    );
    const f = rows[0];
    if (!f) return null;

    return {
      id: f.id,
      inicio: f.inicio,
      personas: f.personas,
      estado: f.estado,
      notas: f.notas,
      nombre: f.nombre ?? '',
      sePuedeCancelar:
        f.estado === 'confirmada' &&
        new Date(f.inicio) > sumarMinutos(ahora, local.cancelacionMin),
    };
  });
}

export type ResultadoCancelacion =
  | { tipo: 'cancelada' }
  | { tipo: 'no_existe' }
  | { tipo: 'ya_no_se_puede'; cancelacionMin: number }
  | { tipo: 'ya_estaba_cancelada' };

/**
 * Cancela una reserva desde el link del cliente.
 *
 * Suelta la mesa en el acto. Que cancelar sea fácil es lo que hace que la gente
 * cancele en vez de no aparecer, y una mesa liberada tres horas antes se vuelve a
 * vender; un no-show no.
 */
export async function cancelarPorToken(
  pool: pg.Pool,
  local: LocalPublico,
  token: string,
  ahora = new Date(),
): Promise<ResultadoCancelacion> {
  return conTenant(pool, local.id, async (c) => {
    const { rows } = await c.query(
      `SELECT id, inicio, estado, cliente_id FROM reservas WHERE token_hash = $1`,
      [hashearToken(token)],
    );
    const reserva = rows[0];
    if (!reserva) return { tipo: 'no_existe' as const };
    if (reserva.estado === 'cancelada') return { tipo: 'ya_estaba_cancelada' as const };
    if (
      reserva.estado !== 'confirmada' ||
      new Date(reserva.inicio) <= sumarMinutos(ahora, local.cancelacionMin)
    ) {
      return { tipo: 'ya_no_se_puede' as const, cancelacionMin: local.cancelacionMin };
    }

    await c.query(
      `UPDATE reservas SET estado = 'cancelada', actualizado_en = now() WHERE id = $1`,
      [reserva.id],
    );
    // Liberar la mesa es el punto de cancelar: si el inventario no se suelta, la
    // cancelación es un cambio de etiqueta y el lugar sigue perdido.
    await c.query(`DELETE FROM reservas_mesas WHERE reserva_id = $1`, [reserva.id]);

    if (reserva.cliente_id) {
      await c.query(
        `UPDATE clientes SET cancelaciones = cancelaciones + 1, actualizado_en = now()
          WHERE id = $1`,
        [reserva.cliente_id],
      );
    }
    await registrarEvento(c, local.id, reserva.id, 'cancelada', { tipo: 'cliente' }, {
      por: 'link del cliente',
    });
    return { tipo: 'cancelada' as const };
  });
}
