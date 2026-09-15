'use client';

import { useActionState } from 'react';
import { moverDeMesa } from '../../acciones';
import type { SalonEnPlano } from '../../../../servicios/panel';

/**
 * Cambio manual de mesa. Fija la asignación: a partir de acá el re-optimizador
 * automático no la toca, y queda registrado quién la movió (D2).
 */
export default function Mover({
  reservaId, salones, actuales,
}: {
  reservaId: string;
  salones: SalonEnPlano[];
  actuales: string[];
}) {
  const [error, enviar, enviando] = useActionState(
    async (_previo: string | null, datos: FormData) => moverDeMesa(datos),
    null,
  );

  return (
    <section className="tarjeta">
      <h2>Cambiar de mesa</h2>
      {error && <p className="aviso">{error}</p>}
      <form action={enviar}>
        <input type="hidden" name="reservaId" value={reservaId} />
        <label>
          Mesa
          <select name="mesaId" defaultValue="" required>
            <option value="" disabled>Elegí una mesa</option>
            {salones.map((s) => (
              <optgroup key={s.id} label={s.nombre}>
                {s.mesas.map((m) => {
                  const suya = actuales.includes(m.nombre);
                  return (
                    <option key={m.id} value={m.id} disabled={Boolean(m.ocupadaPor) && !suya}>
                      {m.nombre} · {m.capacidadBase}
                      {m.cabeceras > 0 && `–${m.capacidadBase + m.cabeceras}`} lugares
                      {m.ocupadaPor && !suya ? ' (ocupada)' : ''}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          Por qué
          <input name="motivo" placeholder="Opcional, pero ayuda a entender después" />
        </label>
        <button type="submit" disabled={enviando}>
          {enviando ? 'Moviendo…' : 'Mover'}
        </button>
      </form>
    </section>
  );
}
