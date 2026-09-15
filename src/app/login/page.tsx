'use client';

import { useActionState } from 'react';
import { iniciarSesion } from './acciones';

export default function Login() {
  const [estado, enviar, enviando] = useActionState(iniciarSesion, null);

  return (
    <main className="contenido angosto" style={{ paddingTop: 64 }}>
      <h1 style={{ fontSize: 22, marginBottom: 20 }}>Reservas</h1>
      <form action={enviar} className="tarjeta">
        <h2>Entrar</h2>
        {estado && <p className="aviso">{estado.error}</p>}
        <label>
          Mail
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            defaultValue={estado?.email ?? ''}
          />
        </label>
        <label>
          Contraseña
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
