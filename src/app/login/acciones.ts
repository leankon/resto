'use server';

import { redirect } from 'next/navigation';
import { borrarCookieSesion, guardarSesion, poolAuth, sesion } from '../../web/contexto';
import { cerrarSesion, elegirLocal, login } from '../../servicios/auth';
import { cookies } from 'next/headers';
import { COOKIE } from '../../web/contexto';

/**
 * React 19 limpia el formulario después de cada submit, así que el mail hay que
 * devolverlo para volver a ponerlo: si no, quien le erra a la contraseña tiene que
 * retipear también su dirección.
 */
export interface EstadoLogin {
  error: string;
  email: string;
}

export async function iniciarSesion(
  _previo: EstadoLogin | null,
  datos: FormData,
): Promise<EstadoLogin | null> {
  const email = String(datos.get('email') ?? '');
  const password = String(datos.get('password') ?? '');
  if (!email || !password) return { error: 'Completá los dos campos.', email };

  const resultado = await login(poolAuth(), { email, password });
  // El mensaje no distingue entre mail inexistente y contraseña incorrecta: decirlo
  // convierte el login en una forma de averiguar quién tiene cuenta.
  if (resultado.tipo === 'credenciales_invalidas') {
    return { error: 'Usuario o contraseña incorrectos.', email };
  }
  if (resultado.tipo === 'sin_locales') {
    return { error: 'Tu usuario todavía no tiene ningún local asignado.', email };
  }

  await guardarSesion(resultado.token, resultado.expiraEn);
  redirect(resultado.tenantId ? '/panel' : '/elegir-local');
}

export async function abrirLocal(datos: FormData): Promise<void> {
  const token = (await cookies()).get(COOKIE)?.value;
  const tenantId = String(datos.get('tenantId') ?? '');
  if (token && (await elegirLocal(poolAuth(), token, tenantId))) redirect('/panel');
  redirect('/login');
}

export async function salir(): Promise<void> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) await cerrarSesion(poolAuth(), token);
  await borrarCookieSesion();
  redirect('/login');
}

export async function localesDisponibles() {
  const actual = await sesion();
  if (!actual || actual.tipo !== 'staff') return [];
  const { rows } = await poolAuth().query(
    `SELECT t.id, t.nombre, ut.rol FROM usuarios_tenants ut
       JOIN tenants t ON t.id = ut.tenant_id
      WHERE ut.usuario_id = $1 AND t.estado = 'activo' ORDER BY t.nombre`,
    [actual.usuarioId],
  );
  return rows as { id: string; nombre: string; rol: string }[];
}
