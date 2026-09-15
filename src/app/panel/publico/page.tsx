import Link from 'next/link';
import { headers } from 'next/headers';
import { poolApp, requerirDuenio } from '../../../web/contexto';
import { cargarDatosPublicos } from '../../../servicios/configuracion';
import { Ajustes, ParaCopiar } from './formularios';

/**
 * La dirección pública de este servidor, tal como la ve quien entra.
 *
 * Sale de la request y no de una variable de entorno: el mismo código corre en
 * localhost, en la URL de prueba de Vercel y en el dominio propio del día que lo
 * haya, y el link que se copia tiene que ser el correcto en los tres casos.
 */
async function origen(): Promise<string> {
  const cabeceras = await headers();
  const host = cabeceras.get('x-forwarded-host') ?? cabeceras.get('host') ?? 'localhost:3000';
  const protocolo = cabeceras.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${protocolo}://${host}`;
}

export default async function WebPublica() {
  const ctx = await requerirDuenio();
  const datos = await cargarDatosPublicos(poolApp(), ctx.tenantId);
  const base = await origen();
  const link = `${base}/r/${datos.slug}`;
  const snippet = `<script src="${link}/embed.js" async></script>`;

  return (
    <>
      <header className="barra">
        <span className="marca">{ctx.tenant.nombre}</span>
        <Link className="boton secundario chico" href="/panel/salon">El salón</Link>
        <Link className="boton secundario chico" href="/panel/horarios">Horarios</Link>
        <Link className="boton secundario chico" href="/panel/equipo">Equipo</Link>
        <Link className="boton secundario chico" href="/panel">Volver al día</Link>
      </header>

      <main className="contenido">
        <h1 style={{ fontSize: 20, margin: '4px 0 6px' }}>Reservas por internet</h1>
        <p className="apagado" style={{ marginTop: 0 }}>
          La página donde reserva la gente, y el recuadro para meterla adentro de la web del
          local. Las reservas que entren por acá caen en la misma planilla del día.
        </p>

        {!datos.webPublica && (
          <p className="aviso">
            La página está apagada: quien entre al link va a ver el teléfono del local, no el
            formulario. Prendela abajo cuando el salón y los horarios estén cargados.
          </p>
        )}

        <section className="tarjeta">
          <h2>El link del local</h2>
          <ParaCopiar texto={link} etiqueta="el link" />
          <p className="apagado">
            Va en Instagram, en Google, en el pie de los mails. <a href={link} target="_blank" rel="noreferrer">Abrilo para ver cómo quedó</a>.
          </p>
        </section>

        <section className="tarjeta">
          <h2>Para la web del local</h2>
          <p className="apagado" style={{ marginTop: 0 }}>
            Pegá esta línea donde quieras que aparezca el recuadro de reservas. No hay nada
            más que configurar; se acomoda solo al ancho y al alto que necesita.
          </p>
          <ParaCopiar texto={snippet} etiqueta="el código" />
        </section>

        <section className="tarjeta">
          <h2>Cómo toma reservas</h2>
          <Ajustes datos={datos} />
        </section>
      </main>
    </>
  );
}
