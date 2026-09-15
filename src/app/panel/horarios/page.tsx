import Link from 'next/link';
import { poolApp, requerirEncargado } from '../../../web/contexto';
import { cargarConfiguracion } from '../../../servicios/configuracion';
import { Duraciones, Excepciones, Franjas, NombreDelLocal } from './formularios';

export default async function Horarios() {
  const ctx = await requerirEncargado();
  const esDuenio = ctx.sesion.rol === 'dueño';
  const config = await cargarConfiguracion(poolApp(), ctx.tenantId);
  const sinFranjasActivas = config.franjas.every((f) => !f.activa);

  return (
    <>
      <header className="barra">
        <span className="marca">{ctx.tenant.nombre}</span>
        <Link className="boton secundario chico" href="/panel/salon">El salón</Link>
        {esDuenio && (
          <Link className="boton secundario chico" href="/panel/publico">Reservas web</Link>
        )}
        {esDuenio && (
          <Link className="boton secundario chico" href="/panel/equipo">Equipo</Link>
        )}
        <Link className="boton secundario chico" href="/panel">Volver al día</Link>
      </header>

      <main className="contenido">
        <h1 style={{ fontSize: 20, margin: '4px 0 6px' }}>Horarios y turnos</h1>
        <p className="apagado" style={{ marginTop: 0 }}>
          Cuándo abre el local y cuánto ocupa la mesa cada grupo. De acá sale qué horarios
          se pueden reservar y hasta qué hora queda ocupada cada mesa.
        </p>

        {sinFranjasActivas && (
          <p className="aviso">
            No hay ninguna franja activa: el local no va a aceptar reservas a ninguna hora.
          </p>
        )}

        <section className="tarjeta">
          <h2>El local</h2>
          <NombreDelLocal nombre={config.nombre} />
          <p className="apagado">
            Zona horaria: <strong>{config.tz}</strong>. Todos los horarios de esta pantalla
            son hora local del local, no la de quien reserva.
          </p>
        </section>

        <section className="tarjeta">
          <h2>Cuándo abre</h2>
          <Franjas franjas={config.franjas} />
        </section>

        <section className="tarjeta">
          <h2>Cuánto dura un turno</h2>
          <Duraciones duraciones={config.duraciones} franjas={config.franjas} />
        </section>

        <section className="tarjeta">
          <h2>Días especiales</h2>
          <Excepciones excepciones={config.excepciones} />
        </section>
      </main>
    </>
  );
}
