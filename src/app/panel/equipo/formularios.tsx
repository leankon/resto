'use client';

import { Fragment, useActionState } from 'react';
import type { MiembroDelEquipo } from '../../../servicios/equipo';
import { actualizarRol, agregar, nuevaPassword, quitar } from './acciones';

const ROLES: [string, string, string][] = [
  ['dueño', 'Dueño', 'Todo, incluido el equipo y la configuración'],
  ['encargado', 'Encargado', 'El día a día, el salón y los horarios'],
  ['mozo', 'Mozo', 'Solo el día: reservas, llegadas y mesas'],
];

const conMensaje = (accion: (datos: FormData) => Promise<string | null>) =>
  async (_previo: string | null, datos: FormData) => accion(datos);

export function Equipo({ equipo, yo }: { equipo: MiembroDelEquipo[]; yo: string }) {
  const [errorRol, cambiar] = useActionState(conMensaje(actualizarRol), null);
  const [errorQuitar, sacar] = useActionState(conMensaje(quitar), null);
  const [errorClave, cambiarClave, cambiandoClave] = useActionState(nuevaPassword, null);
  const aviso = errorRol ?? errorQuitar ?? errorClave;

  return (
    <>
      {aviso && <p className="aviso">{aviso}</p>}
      <table className="editor-mesas">
        <thead>
          <tr><th>Quién</th><th>Mail</th><th>Puede</th><th>Contraseña nueva</th><th /></tr>
        </thead>
        <tbody>
          {equipo.map((m) => (
            <tr key={m.usuarioId}>
              <td>
                <strong>{m.nombre}</strong>
                {m.usuarioId === yo && <span className="apagado"> · sos vos</span>}
                {m.enOtrosLocales && (
                  <div className="apagado" style={{ fontSize: 12 }}>
                    también trabaja en otro local
                  </div>
                )}
              </td>
              <td className="apagado">{m.email}</td>
              <td>
                <select form={`rol-${m.usuarioId}`} name="rol" defaultValue={m.rol}>
                  {ROLES.map(([valor, texto, ayuda]) => (
                    <option key={valor} value={valor} title={ayuda}>{texto}</option>
                  ))}
                </select>{' '}
                <button form={`rol-${m.usuarioId}`} className="secundario chico" type="submit">
                  Cambiar
                </button>
              </td>
              <td>
                <input form={`cl-${m.usuarioId}`} type="password" name="password"
                       placeholder="al menos 10 caracteres" minLength={10}
                       style={{ width: 170 }} />{' '}
                <button form={`cl-${m.usuarioId}`} className="secundario chico" type="submit"
                        disabled={cambiandoClave}>
                  Guardar
                </button>
              </td>
              <td>
                {m.usuarioId !== yo && (
                  <button form={`q-${m.usuarioId}`} className="secundario chico" type="submit">
                    Sacar del local
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {equipo.map((m) => (
        <Fragment key={m.usuarioId}>
          <form id={`rol-${m.usuarioId}`} action={cambiar} hidden>
            <input type="hidden" name="usuarioId" value={m.usuarioId} />
          </form>
          <form id={`cl-${m.usuarioId}`} action={cambiarClave} hidden>
            <input type="hidden" name="usuarioId" value={m.usuarioId} />
          </form>
          <form id={`q-${m.usuarioId}`} action={sacar} hidden>
            <input type="hidden" name="usuarioId" value={m.usuarioId} />
          </form>
        </Fragment>
      ))}

      <p className="apagado">
        Cambiarle la contraseña a alguien le cierra las sesiones que tenga abiertas, igual
        que sacarlo del local. Sacar a alguien no borra su cuenta: puede estar trabajando
        en otro local de la plataforma.
      </p>
    </>
  );
}

export function AgregarPersona() {
  const [error, enviar, enviando] = useActionState(agregar, null);
  return (
    <form action={enviar} key={error ?? 'limpio'}>
      {error && <p className="aviso">{error}</p>}
      <div className="fila">
        <label style={{ flex: '1 1 150px' }}>
          Nombre
          <input name="nombre" required placeholder="Nombre y apellido" />
        </label>
        <label style={{ flex: '1 1 190px' }}>
          Mail
          <input name="email" type="email" required />
        </label>
        <label style={{ flex: '0 1 170px' }}>
          Contraseña inicial
          <input name="password" type="password" minLength={10} required />
        </label>
        <label style={{ flex: '0 1 150px' }}>
          Puede
          <select name="rol" defaultValue="mozo">
            {ROLES.map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
          </select>
        </label>
        <div style={{ flex: '0 0 auto' }}>
          <button type="submit" disabled={enviando}>Agregar</button>
        </div>
      </div>
      <p className="apagado" style={{ marginTop: -4 }}>
        Si esa persona ya tiene cuenta en otro local de la plataforma, se la suma a este
        con la misma cuenta y sigue entrando con su contraseña de siempre.
      </p>
    </form>
  );
}
