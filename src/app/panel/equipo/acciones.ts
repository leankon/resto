'use server';

import { revalidatePath } from 'next/cache';
import { poolAdmin, requerirDuenio } from '../../../web/contexto';
import type { Rol } from '../../../servicios/administracion';
import {
  agregarAlEquipo, cambiarPassword, cambiarRol, quitarDelEquipo,
} from '../../../servicios/equipo';

const RUTA = '/panel/equipo';
const ROLES: Rol[] = ['dueño', 'encargado', 'mozo'];
const leerRol = (datos: FormData): Rol => {
  const rol = String(datos.get('rol') ?? '');
  return ROLES.includes(rol as Rol) ? (rol as Rol) : 'mozo';
};

/**
 * En todas estas acciones el local sale de la sesión, nunca del formulario. Si viniera
 * del navegador, cualquiera podría agregarse a sí mismo al local de otro.
 */
export async function agregar(_previo: string | null, datos: FormData) {
  const ctx = await requerirDuenio();
  const r = await agregarAlEquipo(poolAdmin(), ctx.tenantId, {
    email: String(datos.get('email') ?? ''),
    nombre: String(datos.get('nombre') ?? ''),
    password: String(datos.get('password') ?? ''),
    rol: leerRol(datos),
  });
  revalidatePath(RUTA);
  if (r.tipo === 'invalido') return r.motivo;
  if (r.tipo === 'ya_esta') return 'Esa persona ya trabaja en este local.';
  return null;
}

export async function actualizarRol(datos: FormData): Promise<string | null> {
  const ctx = await requerirDuenio();
  const r = await cambiarRol(
    poolAdmin(), ctx.tenantId, String(datos.get('usuarioId')), leerRol(datos),
  );
  revalidatePath(RUTA);
  return r.tipo === 'ultimo_duenio'
    ? 'Es el único dueño que queda. Sin ninguno, nadie puede volver a cambiar la configuración del local.'
    : null;
}

export async function quitar(datos: FormData): Promise<string | null> {
  const ctx = await requerirDuenio();
  const r = await quitarDelEquipo(
    poolAdmin(), ctx.tenantId, String(datos.get('usuarioId')), ctx.sesion.usuarioId,
  );
  revalidatePath(RUTA);
  if (r.tipo === 'sos_vos') return 'No podés sacarte a vos mismo del local.';
  if (r.tipo === 'ultimo_duenio') {
    return 'Es el único dueño que queda. Nombrá a otro antes de sacarlo.';
  }
  return null;
}

export async function nuevaPassword(_previo: string | null, datos: FormData) {
  const ctx = await requerirDuenio();
  const r = await cambiarPassword(
    poolAdmin(), ctx.tenantId, String(datos.get('usuarioId')),
    String(datos.get('password') ?? ''),
  );
  revalidatePath(RUTA);
  return r.tipo === 'invalido' ? r.motivo : null;
}
