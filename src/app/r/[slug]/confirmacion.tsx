'use client';

import { useActionState } from 'react';
import { confirmarReserva, type EstadoConfirmacion } from './acciones';

/**
 * Los datos del comensal. Es el último paso y el único con estado del lado del
 * cliente: si algo falla, lo tipeado tiene que seguir ahí.
 */
export default function Confirmacion({
  slug,
  canal,
  fecha,
  hora,
  personas,
  compacto,
}: {
  slug: string;
  canal: 'web' | 'widget';
  fecha: string;
  hora: string;
  personas: number;
  compacto: boolean;
}) {
  const [estado, enviar, enviando] = useActionState<EstadoConfirmacion | null, FormData>(
    confirmarReserva.bind(null, { slug, canal }),
    null,
  );
  const valores = estado?.valores;

  return (
    <form action={enviar}>
      {estado && (
        <p className="aviso">
          {estado.error}
          {estado.alternativas.length > 0 &&
            ` Cerca hay lugar a las ${estado.alternativas.join(', ')}.`}
        </p>
      )}
      <input type="hidden" name="fecha" value={fecha} />
      <input type="hidden" name="hora" value={hora} />
      <input type="hidden" name="personas" value={personas} />

      <label>
        Nombre y apellido
        <input name="nombre" required autoComplete="name" defaultValue={valores?.nombre ?? ''} />
      </label>
      <label>
        Teléfono
        <input
          name="telefono"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="11 2345-6789"
          defaultValue={valores?.telefono ?? ''}
        />
      </label>
      <label>
        Mail <span className="apagado">(opcional si dejás teléfono)</span>
        <input name="email" type="email" autoComplete="email" defaultValue={valores?.email ?? ''} />
      </label>
      <label>
        Algo que debamos saber <span className="apagado">(opcional)</span>
        <textarea
          name="notas"
          rows={compacto ? 2 : 3}
          placeholder="Celiaquía, sillita para bebé, festejo…"
          defaultValue={valores?.notas ?? ''}
        />
      </label>
      <button type="submit" disabled={enviando}>
        {enviando ? 'Confirmando…' : 'Confirmar reserva'}
      </button>
      <p className="apagado" style={{ marginTop: 10, marginBottom: 0 }}>
        No hace falta que te registres ni que dejes una tarjeta.
      </p>
    </form>
  );
}
