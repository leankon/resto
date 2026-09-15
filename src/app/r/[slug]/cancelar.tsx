'use client';

import { useActionState, useState } from 'react';
import { cancelar } from './acciones';

/**
 * Cancelar en dos toques: el primero pregunta, el segundo cancela.
 *
 * Que cancelar sea fácil es lo que hace que la gente cancele en vez de no aparecer, y
 * una mesa liberada tres horas antes se vuelve a vender. Pero un solo botón, al lado
 * de la confirmación, se aprieta sin querer.
 */
export default function Cancelar({
  slug,
  token,
  sePuede,
  telefono,
}: {
  slug: string;
  token: string;
  sePuede: boolean;
  telefono: string | null;
}) {
  const [error, enviar, enviando] = useActionState<string | null, FormData>(
    cancelar.bind(null, { slug, token }),
    null,
  );
  const [preguntando, setPreguntando] = useState(false);

  if (!sePuede) {
    return (
      <p className="apagado">
        ¿No podés venir?{' '}
        {telefono ? `Avisanos al ${telefono}.` : 'Avisale al local, así liberamos la mesa.'}
      </p>
    );
  }

  return (
    <form action={enviar}>
      {error && <p className="aviso">{error}</p>}
      {preguntando ? (
        <div className="acciones">
          <button type="submit" disabled={enviando}>
            {enviando ? 'Cancelando…' : 'Sí, cancelar la reserva'}
          </button>
          <button
            type="button"
            className="secundario"
            onClick={() => setPreguntando(false)}
            disabled={enviando}
          >
            No, dejarla
          </button>
        </div>
      ) : (
        <button type="button" className="secundario" onClick={() => setPreguntando(true)}>
          No voy a poder ir
        </button>
      )}
    </form>
  );
}
