'use server';

import { revalidatePath } from 'next/cache';
import { actorDe, poolApp, requerirStaff } from '../../web/contexto';
import { instanteDeServicio } from '../../dominio/agenda';
import { corteDelLocal } from '../../servicios/panel';
import {
  cambiarEstado,
  crearReserva,
  ocuparMesa,
  reasignarMesa,
  type EstadoReserva,
} from '../../servicios/reservas';

/** Sentar, terminar, cancelar o marcar que no vino. */
export async function marcarEstado(datos: FormData): Promise<void> {
  const ctx = await requerirStaff();
  await cambiarEstado(poolApp(), {
    tenantId: ctx.tenantId,
    reservaId: String(datos.get('reservaId')),
    estado: String(datos.get('estado')) as EstadoReserva,
    actor: actorDe(ctx),
  });
  revalidatePath('/panel');
}

export async function registrarWalkIn(datos: FormData): Promise<string | null> {
  const ctx = await requerirStaff();
  const resultado = await ocuparMesa(poolApp(), {
    tenantId: ctx.tenantId,
    mesaIds: [String(datos.get('mesaId'))],
    personas: Number(datos.get('personas') ?? 2),
    actor: actorDe(ctx),
  });
  revalidatePath('/panel');
  return resultado.tipo === 'mesa_no_disponible' ? 'Esa mesa ya está ocupada.' : null;
}

export async function moverDeMesa(datos: FormData): Promise<string | null> {
  const ctx = await requerirStaff();
  const motivo = String(datos.get('motivo') ?? '').trim();
  const resultado = await reasignarMesa(poolApp(), {
    tenantId: ctx.tenantId,
    reservaId: String(datos.get('reservaId')),
    mesaIds: datos.getAll('mesaId').map(String).filter(Boolean),
    ...(motivo ? { motivo } : {}),
    actor: actorDe(ctx),
  });
  revalidatePath('/panel');
  if (resultado.tipo === 'mesa_ocupada') return 'Esa mesa ya está ocupada en ese horario.';
  if (resultado.tipo === 'reserva_inexistente') return 'No encontramos la reserva.';
  return null;
}

export interface ValoresReserva {
  fecha: string;
  hora: string;
  personas: string;
  nombre: string;
  telefono: string;
  email: string;
  notas: string;
}

export interface RespuestaNuevaReserva {
  error?: string;
  ok?: string;
  alternativas?: { hora: string; mesas: string }[];
  /**
   * Lo que se había cargado. React 19 limpia el formulario después de cada submit, y
   * sin esto quien recibe un "no hay lugar" tiene que volver a tipear el nombre, el
   * teléfono y las notas solo para probar quince minutos más tarde.
   */
  valores?: ValoresReserva;
}

/**
 * Alta de reserva desde el mostrador.
 *
 * Recorre exactamente el mismo camino que una reserva de la web o de WhatsApp; lo
 * único que cambia es `canalOrigen`. Así el panel muestra una sola realidad.
 */
/** Un cliente ya registrado que todavía no fue marcado como presente tiene 0 visitas. */
function resumenDelCliente(cliente: { esNuevo: boolean; visitas: number; noShows: number }): string {
  if (cliente.esNuevo) return 'Cliente nuevo.';
  if (cliente.visitas === 0) return 'Ya tenía ficha acá, todavía sin visitas registradas.';
  const visitas = `Ya vino ${cliente.visitas} ${cliente.visitas === 1 ? 'vez' : 'veces'}`;
  return cliente.noShows > 0
    ? `${visitas} y faltó ${cliente.noShows} ${cliente.noShows === 1 ? 'vez' : 'veces'}.`
    : `${visitas}.`;
}

export async function nuevaReserva(
  _previo: RespuestaNuevaReserva | null,
  datos: FormData,
): Promise<RespuestaNuevaReserva> {
  const ctx = await requerirStaff();
  const fecha = String(datos.get('fecha') ?? '');
  const hora = String(datos.get('hora') ?? '');
  const nombre = String(datos.get('nombre') ?? '').trim();
  const notas = String(datos.get('notas') ?? '').trim();
  const valores: ValoresReserva = {
    fecha,
    hora,
    personas: String(datos.get('personas') ?? '2'),
    nombre,
    telefono: String(datos.get('telefono') ?? ''),
    email: String(datos.get('email') ?? ''),
    notas,
  };
  if (!fecha || !hora || !nombre) {
    return { error: 'Faltan la fecha, la hora o el nombre.', valores };
  }

  // La hora se interpreta contra el día de SERVICIO, igual que la planilla: cargar una
  // reserva "a la 01:00 del sábado" tiene que caer en la madrugada del domingo, que es
  // cuando esa gente va a estar sentada.
  const corte = await corteDelLocal(poolApp(), ctx.tenantId);
  const resultado = await crearReserva(poolApp(), {
    tenantId: ctx.tenantId,
    inicio: instanteDeServicio(fecha, hora, ctx.tenant.tz, corte),
    personas: Number(datos.get('personas') ?? 2),
    canalOrigen: 'manual',
    contacto: {
      nombre,
      telefono: String(datos.get('telefono') ?? ''),
      email: String(datos.get('email') ?? ''),
    },
    ...(notas ? { notas } : {}),
    actor: actorDe(ctx),
  });

  switch (resultado.tipo) {
    case 'creada':
      revalidatePath('/panel');
      return {
        ok:
          `Listo: ${nombre}, ${resultado.mesas.length > 1 ? 'mesas' : 'mesa'} ` +
          `${resultado.mesas.map((m) => m.nombre).join(' + ')}` +
          (resultado.cabecerasUsadas > 0
            ? ` (con ${resultado.cabecerasUsadas} silla${resultado.cabecerasUsadas > 1 ? 's' : ''} de punta)`
            : '') +
          `. ${resumenDelCliente(resultado.cliente)}`,
      };
    case 'fuera_de_servicio':
      return { error: 'A esa hora el local está cerrado.', valores };
    case 'cerrado_ese_dia':
      return {
        error: resultado.motivo
          ? `Ese día el local está cerrado: ${resultado.motivo}.`
          : 'Ese día el local está cerrado.',
        valores,
      };
    case 'despues_del_ultimo_ingreso':
      return {
        error: `${resultado.franjaNombre}: el último ingreso es a las ${resultado.ultimoIngreso}.`,
        valores,
      };
    case 'sin_contacto':
      return { error: 'Hace falta un teléfono o un mail para poder avisarle algo.', valores };
    case 'sin_lugar':
      return {
        error: 'No hay mesa libre a esa hora.',
        valores,
        alternativas: resultado.alternativas.map((a) => ({
          hora: new Intl.DateTimeFormat('es-AR', {
            timeZone: ctx.tenant.tz, hour: '2-digit', minute: '2-digit', hour12: false,
          }).format(a.inicio),
          mesas: a.etiqueta,
        })),
      };
  }
}

/**
 * Mover una reserva desde el plano.
 *
 * Es `moverDeMesa` con la forma que espera `useActionState`: el plano necesita mostrar
 * el error al lado del salón, no navegar a otra pantalla.
 */
export async function moverDesdeElPlano(
  _previo: string | null,
  datos: FormData,
): Promise<string | null> {
  return moverDeMesa(datos);
}
