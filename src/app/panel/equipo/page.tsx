import Link from 'next/link';
import { poolAdmin, requerirDuenio } from '../../../web/contexto';
import { listarEquipo } from '../../../servicios/equipo';
import { AgregarPersona, Equipo } from './formularios';

export default async function EquipoDelLocal() {
  const ctx = await requerirDuenio();
  const equipo = await listarEquipo(poolAdmin(), ctx.tenantId);

  return (
    <>
      <header className="barra">
        <span className="marca">{ctx.tenant.nombre}</span>
        <Link className="boton secundario chico" href="/panel/salon">El salón</Link>
        <Link className="boton secundario chico" href="/panel/horarios">Horarios</Link>
        <Link className="boton secundario chico" href="/panel">Volver al día</Link>
      </header>

      <main className="contenido">
        <h1 style={{ fontSize: 20, margin: '4px 0 6px' }}>El equipo</h1>
        <p className="apagado" style={{ marginTop: 0 }}>
          Quién entra al panel de {ctx.tenant.nombre} y qué puede hacer. Un mozo opera el
          día; rediseñar el salón o cambiar los horarios es de encargado para arriba, y
          esta pantalla es solo del dueño.
        </p>

        <section className="tarjeta">
          <h2>Gente que trabaja acá ({equipo.length})</h2>
          <Equipo equipo={equipo} yo={ctx.sesion.usuarioId} />
        </section>

        <section className="tarjeta">
          <h2>Sumar a alguien</h2>
          <AgregarPersona />
        </section>
      </main>
    </>
  );
}
