'use server';

import { revalidatePath } from 'next/cache';
import { poolApp, requerirEncargado } from '../../../web/contexto';
import {
  actualizarMesa, borrarMesa, borrarSalon, cambiarActivaMesa, cambiarMedidasSalon,
  cambiarRadioCombinacion, crearMesa, crearSalon, moverMesa, quitarVeto, renombrarSalon,
  vetarCombinacion, type DatosMesa,
} from '../../../servicios/plano';
import type { FormaMesa } from '../../../dominio/tipos';

const FORMAS: FormaMesa[] = ['rect', 'cuadrada', 'redonda', 'barra'];

const RUTA = '/panel/salon';

function leerMesa(datos: FormData): DatosMesa {
  return {
    nombre: String(datos.get('nombre') ?? ''),
    capacidadBase: Number(datos.get('capacidadBase') ?? 2),
    cabeceras: Number(datos.get('cabeceras') ?? 0),
    capacidadMin: Number(datos.get('capacidadMin') ?? 1),
    x: Number(datos.get('x') ?? 0),
    y: Number(datos.get('y') ?? 0),
    forma: FORMAS.includes(String(datos.get('forma')) as FormaMesa)
      ? (String(datos.get('forma')) as FormaMesa)
      : 'rect',
    combinable: datos.get('combinable') !== null,
  };
}

export async function agregarSalon(_previo: string | null, datos: FormData) {
  const ctx = await requerirEncargado();
  const nombre = String(datos.get('nombre') ?? '').trim();
  if (!nombre) return 'Poné un nombre.';
  await crearSalon(poolApp(), ctx.tenantId, nombre);
  revalidatePath(RUTA);
  return null;
}

export async function renombrar(datos: FormData) {
  const ctx = await requerirEncargado();
  const nombre = String(datos.get('nombre') ?? '').trim();
  if (nombre) await renombrarSalon(poolApp(), ctx.tenantId, String(datos.get('salonId')), nombre);
  revalidatePath(RUTA);
}

export async function eliminarSalon(datos: FormData): Promise<string | null> {
  const ctx = await requerirEncargado();
  const r = await borrarSalon(poolApp(), ctx.tenantId, String(datos.get('salonId')));
  revalidatePath(RUTA);
  return r.tipo === 'tiene_mesas'
    ? `Todavía tiene ${r.mesas} ${r.mesas === 1 ? 'mesa' : 'mesas'}. Movelas o borralas primero.`
    : null;
}

export async function agregarMesa(_previo: string | null, datos: FormData) {
  const ctx = await requerirEncargado();
  const r = await crearMesa(poolApp(), ctx.tenantId, String(datos.get('salonId')), leerMesa(datos));
  revalidatePath(RUTA);
  if (r.tipo === 'nombre_repetido') return 'Ya hay una mesa con ese nombre en este salón.';
  if (r.tipo === 'datos_invalidos') return r.motivo;
  return null;
}

export async function guardarMesa(_previo: string | null, datos: FormData) {
  const ctx = await requerirEncargado();
  const r = await actualizarMesa(poolApp(), ctx.tenantId, String(datos.get('mesaId')), leerMesa(datos));
  revalidatePath(RUTA);
  if (r.tipo === 'nombre_repetido') return 'Ya hay una mesa con ese nombre en este salón.';
  if (r.tipo === 'datos_invalidos') return r.motivo;
  return null;
}

/**
 * Se llama al soltar una mesa en el plano.
 *
 * Va por formulario y no por una llamada suelta desde el manejador del puntero: así el
 * guardado usa el mismo camino que el resto de la página, y Next vuelve a renderizar
 * solo. Con la llamada suelta la mesa se guardaba bien pero la columna "Posición" de la
 * tabla seguía mostrando el valor viejo hasta recargar a mano.
 */
export async function reubicar(datos: FormData): Promise<void> {
  const ctx = await requerirEncargado();
  await moverMesa(
    poolApp(),
    ctx.tenantId,
    String(datos.get('mesaId')),
    Number(datos.get('x') ?? 0),
    Number(datos.get('y') ?? 0),
  );
  revalidatePath(RUTA);
}

export async function eliminarMesa(datos: FormData): Promise<string | null> {
  const ctx = await requerirEncargado();
  const r = await borrarMesa(poolApp(), ctx.tenantId, String(datos.get('mesaId')));
  revalidatePath(RUTA);
  return r.tipo === 'tiene_reservas'
    ? `Tiene ${r.reservas} ${r.reservas === 1 ? 'reserva' : 'reservas'} por delante. Desactivala en vez de borrarla: deja de ofrecerse pero lo reservado sigue en pie.`
    : null;
}

export async function alternarActiva(datos: FormData) {
  const ctx = await requerirEncargado();
  await cambiarActivaMesa(
    poolApp(), ctx.tenantId, String(datos.get('mesaId')), datos.get('activa') === 'si',
  );
  revalidatePath(RUTA);
}

export async function vetar(datos: FormData) {
  const ctx = await requerirEncargado();
  await vetarCombinacion(
    poolApp(), ctx.tenantId, String(datos.get('mesaA')), String(datos.get('mesaB')),
    String(datos.get('motivo') ?? '') || undefined,
  );
  revalidatePath(RUTA);
}

export async function desvetar(datos: FormData) {
  const ctx = await requerirEncargado();
  await quitarVeto(poolApp(), ctx.tenantId, String(datos.get('mesaA')), String(datos.get('mesaB')));
  revalidatePath(RUTA);
}

/** Tirador de la esquina del plano: manda las medidas en centímetros. */
export async function redimensionarSalon(datos: FormData): Promise<void> {
  const ctx = await requerirEncargado();
  await cambiarMedidasSalon(
    poolApp(),
    ctx.tenantId,
    String(datos.get('salonId')),
    Number(datos.get('anchoCm') ?? 1200),
    Number(datos.get('altoCm') ?? 800),
  );
  revalidatePath(RUTA);
}

/** Control numérico debajo del plano: viene en metros. */
export async function medidasDesdeFormulario(datos: FormData) {
  const ctx = await requerirEncargado();
  await cambiarMedidasSalon(
    poolApp(),
    ctx.tenantId,
    String(datos.get('salonId')),
    Number(datos.get('anchoM') ?? 12) * 100,
    Number(datos.get('altoM') ?? 8) * 100,
  );
  revalidatePath(RUTA);
}

export async function cambiarRadio(datos: FormData) {
  const ctx = await requerirEncargado();
  await cambiarRadioCombinacion(poolApp(), ctx.tenantId, Number(datos.get('radio') ?? 250));
  revalidatePath(RUTA);
}
