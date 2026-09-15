'use client';

import { useActionState, useState } from 'react';
import type { DatosPublicos } from '../../../servicios/configuracion';
import { guardar } from './acciones';

export function Ajustes({ datos }: { datos: DatosPublicos }) {
  const [error, enviar, enviando] = useActionState<string | null, FormData>(guardar, null);
  const [prendida, setPrendida] = useState(datos.webPublica);

  return (
    <form action={enviar}>
      {error && <p className="aviso">{error}</p>}

      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          name="webPublica"
          defaultChecked={datos.webPublica}
          onChange={(e) => setPrendida(e.target.checked)}
          style={{ width: 'auto', marginTop: 2 }}
        />
        <span style={{ color: 'var(--texto)' }}>
          <strong>Tomar reservas por internet</strong>
          <br />
          <span className="apagado">
            {prendida
              ? 'La página está abierta: cualquiera con el link puede reservar.'
              : 'La página está apagada. El link muestra el teléfono del local en vez del formulario.'}
          </span>
        </span>
      </label>

      <div className="fila">
        <label>
          Dirección
          <input name="direccion" defaultValue={datos.direccion} placeholder="Av. Corrientes 1234" />
        </label>
        <label>
          Teléfono para mostrar
          <input
            name="telefonoPublico"
            defaultValue={datos.telefonoPublico}
            placeholder="11 4567-8900"
          />
        </label>
      </div>

      <label>
        Cómo se presenta el local
        <textarea
          name="descripcion"
          rows={2}
          defaultValue={datos.descripcion}
          placeholder="Cocina de barrio, parrilla a la vista, perros bienvenidos."
        />
      </label>

      <div className="fila">
        <label>
          Anticipación mínima (minutos)
          <input
            name="anticipacionMin"
            type="number"
            min={0}
            max={43200}
            defaultValue={datos.anticipacionMin}
          />
        </label>
        <label>
          Se puede reservar hasta (días)
          <input
            name="diasMaxAnticipacion"
            type="number"
            min={1}
            max={365}
            defaultValue={datos.diasMaxAnticipacion}
          />
        </label>
      </div>
      <p className="apagado" style={{ marginTop: -4 }}>
        Con {datos.anticipacionMin} minutos, a las 20:00 el primer horario que se ofrece es
        el de las {horaMas(datos.anticipacionMin)}.
      </p>

      <div className="fila">
        <label>
          Grupo más grande por internet
          <input
            name="personasMaxWeb"
            type="number"
            min={1}
            max={100}
            defaultValue={datos.personasMaxWeb}
          />
        </label>
        <label>
          Puede cancelar solo hasta (minutos antes)
          <input
            name="cancelacionMin"
            type="number"
            min={0}
            max={43200}
            defaultValue={datos.cancelacionMin}
          />
        </label>
      </div>

      <label>
        Mensaje al confirmar <span className="apagado">(opcional)</span>
        <textarea
          name="mensajeConfirmacion"
          rows={2}
          defaultValue={datos.mensajeConfirmacion}
          placeholder="Te guardamos la mesa 15 minutos. Si llegás más tarde, avisanos."
        />
      </label>

      <button type="submit" disabled={enviando}>
        {enviando ? 'Guardando…' : 'Guardar'}
      </button>
    </form>
  );
}

/** Ejemplo concreto de lo que significa la anticipación, desde las 20:00. */
function horaMas(minutos: number): string {
  const total = 20 * 60 + minutos;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function ParaCopiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <div style={{ marginBottom: 14 }}>
      <code className="snippet">{texto}</code>
      <button
        type="button"
        className="secundario chico"
        style={{ marginTop: 8 }}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(texto);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
          } catch {
            // Sin permiso de portapapeles queda el texto a la vista para seleccionar.
            setCopiado(false);
          }
        }}
      >
        {copiado ? 'Copiado' : `Copiar ${etiqueta}`}
      </button>
    </div>
  );
}
