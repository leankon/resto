'use client';

import { useActionState } from 'react';
import { entrarComoAdmin } from '../acciones';

export default function LoginAdmin() {
  const [estado, enviar, enviando] = useActionState(entrarComoAdmin, null);

  return (
    <main className="contenido angosto" style={{ paddingTop: 64 }}>
      <h1 style={{ fontSize: 22, marginBottom: 20 }}>Administración de la plataforma</h1>
      <form action={enviar} className="tarjeta">
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
        <button type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </main>
  );
}
