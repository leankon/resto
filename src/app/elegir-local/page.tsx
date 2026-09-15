import { redirect } from 'next/navigation';
import { abrirLocal, localesDisponibles } from '../login/acciones';

/** Solo se ve si la persona trabaja en más de un local. */
export default async function ElegirLocal() {
  const locales = await localesDisponibles();
  if (locales.length === 0) redirect('/login');

  return (
    <main className="contenido angosto" style={{ paddingTop: 64 }}>
      <h1 style={{ fontSize: 22, marginBottom: 20 }}>¿En qué local estás hoy?</h1>
      <div className="tarjeta">
        {locales.map((local) => (
          <form key={local.id} action={abrirLocal} style={{ marginBottom: 10 }}>
            <input type="hidden" name="tenantId" value={local.id} />
            <button type="submit" className="secundario" style={{ width: '100%', textAlign: 'left' }}>
              {local.nombre} <span className="apagado">· {local.rol}</span>
            </button>
          </form>
        ))}
      </div>
    </main>
  );
}
