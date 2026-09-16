'use server';

import { revalidatePath } from 'next/cache';
import { poolApp, requerirDuenio } from '../../../web/contexto';
import { guardarDatosPublicos } from '../../../servicios/configuracion';

export async function guardar(_previo: string | null, datos: FormData): Promise<string | null> {
  const ctx = await requerirDuenio();
  const texto = (campo: string) => String(datos.get(campo) ?? '').trim();
  const numero = (campo: string) => Number(datos.get(campo));

  const resultado = await guardarDatosPublicos(poolApp(), ctx.tenantId, {
    webPublica: datos.get('webPublica') === 'on',
    direccion: texto('direccion'),
    telefonoPublico: texto('telefonoPublico'),
    descripcion: texto('descripcion'),
    anticipacionMin: numero('anticipacionMin'),
    diasMaxAnticipacion: numero('diasMaxAnticipacion'),
    personasMaxWeb: numero('personasMaxWeb'),
    cancelacionMin: numero('cancelacionMin'),
    mensajeConfirmacion: texto('mensajeConfirmacion'),
    pasoReservaMin: numero('pasoReservaMin'),
  });

  revalidatePath('/panel/publico');
  return resultado.tipo === 'invalido' ? resultado.motivo : null;
}
