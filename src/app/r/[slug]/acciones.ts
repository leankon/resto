'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { instanteLocal } from '../../../dominio/tiempo';
import { hora as horaDe } from '../../../web/formato';
import { poolApp, poolAuth } from '../../../web/contexto';
import {
  cancelarPorToken,
  localPorSlug,
  reservarDesdeLaWeb,
} from '../../../servicios/publico';

export interface ValoresContacto {
  nombre: string;
  telefono: string;
  email: string;
  notas: string;
}

export interface EstadoConfirmacion {
  error: string;
  /** Horarios cercanos con lugar, cuando el elegido se ocupó mientras completaba. */
  alternativas: string[];
  /**
   * React 19 limpia el formulario después de enviarlo. Sin devolver lo tipeado, un
   * "justo se ocupó" le borra el nombre y el teléfono a quien ya los había escrito.
   */
  valores: ValoresContacto;
}

/**
 * Confirma una reserva de la página pública.
 *
 * Todo lo que llega del navegador se vuelve a validar contra el local: el día, la
 * hora, la cantidad y hasta que la web esté prendida. La grilla de horarios se pintó
 * hace un rato y entre medio pudo entrar otra reserva.
 */
export async function confirmarReserva(
  contexto: { slug: string; canal: 'web' | 'widget' },
  _previo: EstadoConfirmacion | null,
  datos: FormData,
): Promise<EstadoConfirmacion | null> {
  const texto = (campo: string) => String(datos.get(campo) ?? '').trim();
  const valores: ValoresContacto = {
    nombre: texto('nombre'),
    telefono: texto('telefono'),
    email: texto('email'),
    notas: texto('notas'),
  };
  const falla = (error: string, alternativas: string[] = []) => ({
    error,
    alternativas,
    valores,
  });

  const local = await localPorSlug(poolAuth(), contexto.slug);
  if (!local) return falla('No encontramos el local.');

  const fecha = texto('fecha');
  const hora = texto('hora');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) {
    return falla('Elegí un día y un horario.');
  }

  const resultado = await reservarDesdeLaWeb(poolApp(), local, {
    inicio: instanteLocal(fecha, hora, local.tz),
    personas: Number(datos.get('personas')) || 0,
    contacto: {
      nombre: valores.nombre,
      telefono: valores.telefono || null,
      email: valores.email || null,
    },
    canal: contexto.canal,
    ...(valores.notas ? { notas: valores.notas } : {}),
  });

  switch (resultado.tipo) {
    case 'creada':
      break;
    case 'sin_lugar':
      return falla(
        'Justo se ocupó ese horario mientras completabas tus datos.',
        resultado.alternativas.map((a) => horaDe(a.inicio, local.tz)),
      );
    case 'sin_contacto':
      return falla('Dejanos un teléfono o un mail: es la única forma de avisarte algo.');
    case 'grupo_muy_grande':
      return falla(
        `Por internet tomamos hasta ${resultado.maximo} personas.` +
          (local.telefonoPublico ? ` Para un grupo más grande, llamanos al ${local.telefonoPublico}.` : ''),
      );
    case 'muy_sobre_la_hora':
      return falla('Ese horario ya está muy encima. Elegí uno más tarde.');
    case 'fuera_de_plazo':
      return falla(`Todavía no tomamos reservas con tanta anticipación.`);
    case 'web_apagada':
      return falla('El local no está tomando reservas por internet en este momento.');
    case 'cerrado_ese_dia':
      return falla(`Ese día el local está cerrado${resultado.motivo ? `: ${resultado.motivo}` : ''}.`);
    case 'fuera_de_servicio':
      return falla('A esa hora no hay servicio.');
    case 'despues_del_ultimo_ingreso':
      return falla(
        `El último ingreso de ${resultado.franjaNombre} es a las ${resultado.ultimoIngreso}.`,
      );
  }

  // El token va en la URL: es la credencial con la que vuelve a su reserva, y el
  // comensal nunca se crea una cuenta.
  const destino = contexto.canal === 'widget' ? '/widget' : '';
  redirect(`/r/${local.slug}${destino}/reserva/${resultado.token}`);
}

/**
 * Cancela desde el link que recibió el cliente.
 *
 * El token es la credencial. No hay sesión ni cuenta que verificar: quien tiene el
 * link puede cancelar esa reserva y ninguna otra.
 */
export async function cancelar(
  contexto: { slug: string; token: string },
  _previo: string | null,
  _datos: FormData,
): Promise<string | null> {
  const local = await localPorSlug(poolAuth(), contexto.slug);
  if (!local) return 'No encontramos el local.';

  const resultado = await cancelarPorToken(poolApp(), local, contexto.token);
  revalidatePath(`/r/${contexto.slug}/reserva/${contexto.token}`);

  switch (resultado.tipo) {
    case 'cancelada':
    case 'ya_estaba_cancelada':
      return null;
    case 'no_existe':
      return 'Este link ya no es válido.';
    case 'ya_no_se_puede':
      return local.telefonoPublico
        ? `Ya estamos muy cerca de la hora. Llamanos al ${local.telefonoPublico} y lo resolvemos.`
        : 'Ya estamos muy cerca de la hora: avisale al local directamente.';
  }
}
