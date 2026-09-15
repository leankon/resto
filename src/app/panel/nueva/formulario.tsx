'use client';

import { useActionState } from 'react';
import { nuevaReserva } from '../acciones';

export default function Formulario({ fecha }: { fecha: string }) {
  const [respuesta, enviar, enviando] = useActionState(nuevaReserva, null);
  const v = respuesta?.valores;

  return (
    // La clave cambia cuando la reserva sale bien: eso remonta el formulario y lo deja
    // limpio para la siguiente. Mientras haya error, conserva lo que se había cargado.
    <form action={enviar} className="tarjeta" key={respuesta?.ok ?? 'cargando'}>
      {respuesta?.ok && <p className="aviso ok">{respuesta.ok}</p>}
      {respuesta?.error && (
        <div className="aviso">
          {respuesta.error}
          {respuesta.alternativas && respuesta.alternativas.length > 0 && (
            <div style={{ marginTop: 8 }}>
              Sí hay lugar a las{' '}
              {respuesta.alternativas.map((a, i) => (
                <span key={a.hora}>
                  {i > 0 && ', '}
                  <strong>{a.hora}</strong> (mesa {a.mesas})
                </span>
              ))}
              .
            </div>
          )}
        </div>
      )}

      <div className="fila">
        <label>
          Día
          <input name="fecha" type="date" defaultValue={v?.fecha || fecha} required />
        </label>
        <label>
          Hora
          {/* Cualquier minuto, no la grilla: el que llama por teléfono pide las 21:10
              y obligar al mozo a redondear le hace perder la mesa o mentir la hora. */}
          <input type="time" name="hora" defaultValue={v?.hora || '21:00'} required />
        </label>
        <label>
          Personas
          <input
            name="personas" type="number" min={1} max={40}
            defaultValue={v?.personas || '2'} required
          />
        </label>
      </div>

      <label>
        Nombre
        <input
          name="nombre" required placeholder="Cómo pregunta en la puerta"
          defaultValue={v?.nombre ?? ''}
        />
      </label>

      <div className="fila">
        <label>
          Teléfono
          <input
            name="telefono" inputMode="tel" placeholder="011 15 2345-6789"
            defaultValue={v?.telefono ?? ''}
          />
        </label>
        <label>
          Mail
          <input
            name="email" type="email" placeholder="opcional"
            defaultValue={v?.email ?? ''}
          />
        </label>
      </div>
      <p className="apagado" style={{ marginTop: -6 }}>
        Con uno de los dos alcanza. Sin ninguno no hay forma de avisarle nada.
      </p>

      <label>
        Notas
        <input
          name="notas" placeholder="Cumpleaños, silla de bebé, celíaco…"
          defaultValue={v?.notas ?? ''}
        />
      </label>

      <button type="submit" disabled={enviando}>
        {enviando ? 'Buscando mesa…' : 'Reservar'}
      </button>
    </form>
  );
}
