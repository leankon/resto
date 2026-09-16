'use server';

import { revalidatePath } from 'next/cache';
import { poolApp, requerirEncargado } from '../../../web/contexto';
import type { DiaSemana } from '../../../dominio/tipos';
import {
  borrarDuracion,
  borrarExcepcion,
  borrarFranja,
  cambiarActivaFranja,
  guardarDuracion,
  guardarExcepcion,
  guardarFranja,
  ponerDuracionPareja,
  renombrarLocal,
} from '../../../servicios/configuracion';

const RUTA = '/panel/horarios';

function leerDias(datos: FormData): DiaSemana[] {
  return datos.getAll('dias').map(Number).filter((d) => d >= 0 && d <= 6) as DiaSemana[];
}

export async function guardarNombre(_previo: string | null, datos: FormData) {
  const ctx = await requerirEncargado();
  const r = await renombrarLocal(poolApp(), ctx.tenantId, String(datos.get('nombre') ?? ''));
  revalidatePath(RUTA);
  return r.tipo === 'invalido' ? r.motivo : null;
}

export async function franja(_previo: string | null, datos: FormData) {
  const ctx = await requerirEncargado();
  const id = String(datos.get('franjaId') ?? '');
  const r = await guardarFranja(
    poolApp(),
    ctx.tenantId,
    {
      nombre: String(datos.get('nombre') ?? ''),
      dias: leerDias(datos),
      desde: String(datos.get('desde') ?? ''),
      hasta: String(datos.get('hasta') ?? ''),
      ultimoIngreso: String(datos.get('ultimoIngreso') ?? ''),
    },
    id || undefined,
  );
  revalidatePath(RUTA);
  return r.tipo === 'invalido' ? r.motivo : null;
}

export async function alternarFranja(datos: FormData) {
  const ctx = await requerirEncargado();
  await cambiarActivaFranja(
    poolApp(), ctx.tenantId, String(datos.get('franjaId')), datos.get('activa') === 'si',
  );
  revalidatePath(RUTA);
}

export async function eliminarFranja(datos: FormData): Promise<string | null> {
  const ctx = await requerirEncargado();
  const r = await borrarFranja(poolApp(), ctx.tenantId, String(datos.get('franjaId')));
  revalidatePath(RUTA);
  return r.tipo === 'es_la_ultima'
    ? 'Es la única franja que queda. Sin ninguna, el local no acepta reservas a ninguna hora.'
    : null;
}

export async function duracion(_previo: string | null, datos: FormData) {
  const ctx = await requerirEncargado();
  const id = String(datos.get('duracionId') ?? '');
  const franjaId = String(datos.get('franja') ?? '');
  const r = await guardarDuracion(
    poolApp(),
    ctx.tenantId,
    {
      franjaId: franjaId || null,
      personasMin: Number(datos.get('personasMin') ?? 1),
      personasMax: Number(datos.get('personasMax') ?? 2),
      duracionMin: Number(datos.get('duracionMin') ?? 90),
      bufferMin: Number(datos.get('bufferMin') ?? 0),
    },
    id || undefined,
  );
  revalidatePath(RUTA);
  return r.tipo === 'invalido' ? r.motivo : null;
}

export async function eliminarDuracion(datos: FormData) {
  const ctx = await requerirEncargado();
  await borrarDuracion(poolApp(), ctx.tenantId, String(datos.get('duracionId')));
  revalidatePath(RUTA);
}

export async function excepcion(_previo: string | null, datos: FormData) {
  const ctx = await requerirEncargado();
  const cerrado = datos.get('cerrado') !== null;
  const r = await guardarExcepcion(poolApp(), ctx.tenantId, {
    fecha: String(datos.get('fecha') ?? ''),
    cerrado,
    desde: String(datos.get('desde') ?? '') || null,
    hasta: String(datos.get('hasta') ?? '') || null,
    motivo: String(datos.get('motivo') ?? '') || null,
  });
  revalidatePath(RUTA);
  revalidatePath('/panel');
  return r.tipo === 'invalido' ? r.motivo : null;
}

export async function eliminarExcepcion(datos: FormData) {
  const ctx = await requerirEncargado();
  await borrarExcepcion(poolApp(), ctx.tenantId, String(datos.get('excepcionId')));
  revalidatePath(RUTA);
  revalidatePath('/panel');
}

/** Poner la misma duración en todas las reglas, en vez de editar doce filas de a una. */
export async function duracionPareja(_previo: string | null, datos: FormData) {
  const ctx = await requerirEncargado();
  const r = await ponerDuracionPareja(
    poolApp(),
    ctx.tenantId,
    Number(datos.get('duracionMin') ?? 120),
    Number(datos.get('bufferMin') ?? 0),
  );
  revalidatePath(RUTA);
  return r.tipo === 'invalido' ? r.motivo : null;
}
