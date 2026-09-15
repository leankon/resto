'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  COOKIE,
  borrarCookieSesion,
  guardarSesion,
  poolAdmin,
  poolAuth,
  requerirAdmin,
} from '../../web/contexto';
import { cerrarSesion, loginAdmin } from '../../servicios/auth';
import { altaDeLocal, cambiarEstadoLocal } from '../../servicios/administracion';
import { SALON_DEMO } from '../../datos/semilla';

export async function entrarComoAdmin(
  _previo: { error: string; email: string } | null,
  datos: FormData,
): Promise<{ error: string; email: string } | null> {
  const email = String(datos.get('email') ?? '');
  const resultado = await loginAdmin(poolAuth(), {
    email,
    password: String(datos.get('password') ?? ''),
  });
  if (resultado.tipo === 'credenciales_invalidas') {
    return { error: 'Usuario o contraseña incorrectos.', email };
  }

  await guardarSesion(resultado.token, resultado.expiraEn);
  redirect('/admin');
}

export async function salirDeAdmin(): Promise<void> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) await cerrarSesion(poolAuth(), token);
  await borrarCookieSesion();
  redirect('/admin/login');
}

export interface RespuestaAlta {
  error?: string;
  ok?: string;
}

/**
 * Alta de un local nuevo con su dueño.
 *
 * En Fase 1 el plano se siembra con un salón de ejemplo para poder probar el motor
 * enseguida; la carga del plano real es la pantalla que viene después.
 */
export async function crearLocalNuevo(
  _previo: RespuestaAlta | null,
  datos: FormData,
): Promise<RespuestaAlta> {
  await requerirAdmin();

  const nombre = String(datos.get('nombre') ?? '').trim();
  const slug = String(datos.get('slug') ?? '').trim().toLowerCase();
  const email = String(datos.get('email') ?? '').trim();
  const password = String(datos.get('password') ?? '');

  if (!nombre || !slug || !email || !password) return { error: 'Faltan datos.' };
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
    return { error: 'La dirección web solo puede tener letras, números y guiones.' };
  }
  if (password.length < 10) return { error: 'La contraseña tiene que tener al menos 10 caracteres.' };

  try {
    const creado = await altaDeLocal(poolAdmin(), {
      nombre,
      slug,
      tz: String(datos.get('tz') ?? 'America/Argentina/Buenos_Aires'),
      salones: datos.get('demo') ? SALON_DEMO : [],
      duenio: { email, nombre: String(datos.get('duenio') ?? nombre), password },
    });
    revalidatePath('/admin');
    return {
      ok: `Listo: ${nombre} quedó creado con ${Object.keys(creado.mesas).length} mesas. El dueño ya puede entrar con ${email}.`,
    };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    if (mensaje.includes('tenants_slug_key')) return { error: 'Esa dirección web ya está usada.' };
    return { error: `No se pudo crear: ${mensaje}` };
  }
}

export async function alternarEstado(datos: FormData): Promise<void> {
  await requerirAdmin();
  await cambiarEstadoLocal(
    poolAdmin(),
    String(datos.get('tenantId')),
    String(datos.get('estado')) === 'activo' ? 'activo' : 'suspendido',
  );
  revalidatePath('/admin');
}
