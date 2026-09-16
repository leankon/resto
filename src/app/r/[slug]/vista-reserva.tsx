import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ESTADOS, fechaCorta, hora as horaDe } from '../../../web/formato';
import { poolApp, poolAuth } from '../../../web/contexto';
import { localPorSlug, reservaPorToken } from '../../../servicios/publico';
import Cancelar from './cancelar';

/**
 * La reserva vista por el comensal, detrás de su link.
 *
 * Es todo lo que tiene: no hay cuenta, ni historial, ni contraseña que recuperar. Por
 * eso muestra los datos completos del local, que es a dónde va a llamar si algo pasa.
 */
export default async function VistaReserva({
  slug,
  token,
  compacto = false,
}: {
  slug: string;
  token: string;
  compacto?: boolean;
}) {
  const local = await localPorSlug(poolAuth(), slug);
  if (!local) notFound();

  const reserva = await reservaPorToken(poolApp(), local, token);
  if (!reserva) {
    return (
      <main className={compacto ? 'publico compacto' : 'publico'}>
        <section className="tarjeta">
          <h2>No encontramos esta reserva</h2>
          <p className="apagado">
            El link puede haber vencido o ser de otro local. Si la reserva sigue en pie,
            {local.telefonoPublico ? ` llamá al ${local.telefonoPublico}.` : ' escribile al local.'}
          </p>
          <Link className="boton secundario" href={`/r/${local.slug}`}>
            Reservar de nuevo
          </Link>
        </section>
      </main>
    );
  }

  const cancelada = reserva.estado === 'cancelada';

  return (
    <main className={compacto ? 'publico compacto' : 'publico'}>
      {!compacto && (
        <header className="portada">
          <h1>{local.nombre}</h1>
          <p className="datos">
            {local.direccion && <span>{local.direccion}</span>}
            {local.telefonoPublico && <span>{local.telefonoPublico}</span>}
          </p>
        </header>
      )}

      <section className="tarjeta confirmacion">
        <h2 className={cancelada ? undefined : 'ok'}>
          {cancelada ? 'Reserva cancelada' : '¡Listo, te esperamos!'}
        </h2>
        <p className="resumen">
          <span>
            <b>{fechaCorta(reserva.inicio, local.tz)}</b>
          </span>
          <span>
            a las <b>{horaDe(reserva.inicio, local.tz)}</b>
          </span>
          <span>
            para <b>{reserva.personas}</b>
          </span>
        </p>
        <p className="apagado" style={{ marginTop: 0 }}>
          A nombre de {reserva.nombre}
          {!cancelada && ` · ${ESTADOS[reserva.estado] ?? reserva.estado}`}
        </p>
        {reserva.notas && <p className="apagado">Nos avisaste: {reserva.notas}</p>}

        {!cancelada && local.mensajeConfirmacion && (
          <p className="aviso ok">{local.mensajeConfirmacion}</p>
        )}

        {cancelada ? (
          <Link className="boton secundario" href={`/r/${local.slug}`}>
            Reservar otro día
          </Link>
        ) : (
          <>
            <p className="apagado">
              Guardá este link. Es la forma de volver acá si querés cambiar algo, y no
              hace falta que te registres.
            </p>
            <Cancelar
              slug={local.slug}
              token={token}
              sePuede={reserva.sePuedeCancelar}
              telefono={local.telefonoPublico}
            />
          </>
        )}
      </section>
    </main>
  );
}
