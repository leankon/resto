'use client';

import { useActionState } from 'react';
import type { MesaDelPlano } from '../../../servicios/plano';
import {
  agregarMesa, agregarSalon, alternarActiva, eliminarMesa, eliminarSalon, guardarMesa,
} from './acciones';

/** Envuelve una acción que devuelve un mensaje para poder mostrarlo. */
const conMensaje = (accion: (datos: FormData) => Promise<string | null>) =>
  async (_previo: string | null, datos: FormData) => accion(datos);

export function AgregarSalon() {
  const [error, enviar, enviando] = useActionState(agregarSalon, null);
  return (
    <form action={enviar} className="fila">
      <label style={{ flex: '1 1 240px' }}>
        Cómo se llama
        <input name="nombre" placeholder="Terraza, Planta alta, Barra…" required />
      </label>
      <div style={{ flex: '0 0 auto' }}>
        <button className="secundario" type="submit" disabled={enviando}>Agregar</button>
      </div>
      {error && <p className="aviso" style={{ flexBasis: '100%' }}>{error}</p>}
    </form>
  );
}

export function AgregarMesa({ salonId }: { salonId: string }) {
  const [error, enviar, enviando] = useActionState(agregarMesa, null);
  return (
    <form action={enviar} style={{ marginTop: 16 }} key={error ?? 'limpio'}>
      <input type="hidden" name="salonId" value={salonId} />
      {error && <p className="aviso">{error}</p>}
      <div className="fila">
        <label style={{ flex: '1 1 120px' }}>
          Nombre
          <input name="nombre" required placeholder="12, Barra 3…" />
        </label>
        <label className="angosto">
          Sillas
          <input name="capacidadBase" type="number" min={1} max={40} defaultValue={4} required />
        </label>
        <label className="angosto">
          Cabeceras
          <input name="cabeceras" type="number" min={0} max={2} defaultValue={0} />
        </label>
        <label className="angosto">
          Mínimo
          <input name="capacidadMin" type="number" min={1} defaultValue={1} />
        </label>
        <label style={{ flex: '0 0 auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" name="combinable" defaultChecked
                 style={{ width: 'auto', margin: 0 }} />
          Se puede mover y unir
        </label>
        <div style={{ flex: '0 0 auto' }}>
          <button type="submit" disabled={enviando}>Agregar mesa</button>
        </div>
      </div>
      <p className="apagado" style={{ marginTop: -4 }}>
        Las cabeceras son las sillas que se pueden sumar en las puntas: una mesa de 4 con
        dos cabeceras sienta 6. El mínimo evita que una pareja termine en la mesa de 10.
        Destildá "se puede mover y unir" para lo que está fijo al piso o a la pared: una
        barra, un banco corrido. La mesa aparece arriba a la izquierda; después la arrastrás
        a su lugar.
      </p>
    </form>
  );
}

export function TablaMesas({ mesas }: { mesas: MesaDelPlano[] }) {
  const [error, guardar, guardando] = useActionState(guardarMesa, null);
  const [errorBorrado, borrar] = useActionState(conMensaje(eliminarMesa), null);
  const aviso = error ?? errorBorrado;

  if (mesas.length === 0) return null;

  return (
    <>
      {aviso && <p className="aviso">{aviso}</p>}
      <table>
        <thead>
          <tr>
            <th>Nombre</th><th>Sillas</th><th>Cabeceras</th><th>Mínimo</th>
            <th>Posición</th><th>Se une</th><th /><th />
          </tr>
        </thead>
        <tbody>
          {mesas.map((m) => (
            <tr key={m.id} className={m.activa ? undefined : 'pasada'}>
              <td>
                <input form={`m-${m.id}`} type="text" name="nombre"
                       defaultValue={m.nombre} required style={{ width: 90 }} />
              </td>
              <td>
                <input form={`m-${m.id}`} className="angosto" type="number" name="capacidadBase"
                       min={1} max={40} defaultValue={m.capacidadBase} />
              </td>
              <td>
                <input form={`m-${m.id}`} className="angosto" type="number" name="cabeceras"
                       min={0} max={2} defaultValue={m.cabeceras} />
              </td>
              <td>
                <input form={`m-${m.id}`} className="angosto" type="number" name="capacidadMin"
                       min={1} defaultValue={m.capacidadMin} />
              </td>
              <td className="apagado" style={{ whiteSpace: 'nowrap' }}>{m.x} × {m.y} cm</td>
              <td>
                <input form={`m-${m.id}`} type="checkbox" name="combinable"
                       defaultChecked={m.combinable} style={{ width: 'auto', margin: 0 }} />
              </td>
              <td>
                <button form={`m-${m.id}`} className="secundario chico" type="submit"
                        disabled={guardando}>
                  Guardar
                </button>
              </td>
              <td>
                <div className="acciones">
                  <button form={`activa-${m.id}`} className="secundario chico" type="submit">
                    {m.activa ? 'Desactivar' : 'Activar'}
                  </button>
                  <button form={`borrar-${m.id}`} className="secundario chico" type="submit"
                          disabled={m.reservas > 0}
                          title={m.reservas > 0
                            ? 'Tiene reservas por delante: desactivala en vez de borrarla'
                            : undefined}>
                    Borrar
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Los formularios viven fuera de la tabla porque un <form> no puede ser hijo de
          <tr>: anidar tablas para esquivarlo desalineaba las columnas. Los campos de
          cada fila se enganchan por el atributo `form`. */}
      {mesas.map((m) => (
        <div key={m.id} hidden>
          <form id={`m-${m.id}`} action={guardar}>
            <input type="hidden" name="mesaId" value={m.id} />
            <input type="hidden" name="x" value={m.x} />
            <input type="hidden" name="y" value={m.y} />
          </form>
          <form id={`activa-${m.id}`} action={alternarActiva}>
            <input type="hidden" name="mesaId" value={m.id} />
            <input type="hidden" name="activa" value={m.activa ? 'no' : 'si'} />
          </form>
          <form id={`borrar-${m.id}`} action={borrar}>
            <input type="hidden" name="mesaId" value={m.id} />
          </form>
        </div>
      ))}
    </>
  );
}

export function BorrarSalon({ salonId, nombre }: { salonId: string; nombre: string }) {
  const [error, enviar, enviando] = useActionState(conMensaje(eliminarSalon), null);
  return (
    <form action={enviar} className="tarjeta">
      {error && <p className="aviso">{error}</p>}
      <input type="hidden" name="salonId" value={salonId} />
      <button className="secundario chico" type="submit" disabled={enviando}>
        Borrar el salón {nombre}
      </button>
    </form>
  );
}
