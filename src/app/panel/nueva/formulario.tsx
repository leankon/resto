'use client';

import { useActionState } from 'react';
import { nuevaReserva } from '../acciones';

/** Horarios en punto y cuartos: el cliente reserva sobre la grilla de 15 minutos (D8). */
const HORARIOS = Array.from({ length: 4 * 24 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0');
  const m = String((i % 4) * 15).padStart(2, '0');
  return `${h}:${m}`;
});

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
          <select name="hora" defaultValue={v?.hora || '21:00'} required>
            {HORARIOS.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
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
