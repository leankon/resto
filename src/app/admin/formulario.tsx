'use client';

import { useActionState } from 'react';
import { crearLocalNuevo } from './acciones';

export default function FormularioAlta() {
  const [respuesta, enviar, enviando] = useActionState(crearLocalNuevo, null);

  return (
    <form action={enviar} className="tarjeta">
      <h2>Dar de alta un local</h2>
      {respuesta?.ok && <p className="aviso ok">{respuesta.ok}</p>}
      {respuesta?.error && <p className="aviso">{respuesta.error}</p>}

      <div className="fila">
        <label>
          Nombre del local
          <input name="nombre" required placeholder="Bar Fulano" />
        </label>
        <label>
          Dirección web
          <input name="slug" required placeholder="bar-fulano" pattern="[a-z0-9\-]{3,40}" />
        </label>
      </div>

      <label>
        Zona horaria
        <select name="tz" defaultValue="America/Argentina/Buenos_Aires">
          <option value="America/Argentina/Buenos_Aires">Argentina (Buenos Aires)</option>
          <option value="America/Montevideo">Uruguay (Montevideo)</option>
          <option value="America/Santiago">Chile (Santiago)</option>
          <option value="America/Sao_Paulo">Brasil (San Pablo)</option>
          <option value="Europe/Madrid">España (Madrid)</option>
        </select>
      </label>

      <div className="fila">
        <label>
          Dueño
          <input name="duenio" placeholder="Nombre y apellido" />
        </label>
        <label>
          Mail del dueño
          <input name="email" type="email" required />
        </label>
      </div>

      <label>
        Contraseña inicial
        <input name="password" type="password" minLength={10} required />
      </label>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" name="demo" defaultChecked style={{ width: 'auto', margin: 0 }} />
        Cargar un salón de ejemplo para poder probar el motor enseguida
      </label>

      <button type="submit" disabled={enviando}>
        {enviando ? 'Creando…' : 'Crear local'}
      </button>
    </form>
  );
}
