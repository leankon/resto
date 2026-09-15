'use client';

import Link from 'next/link';
import { useOptimistic } from 'react';
import { useFormStatus } from 'react-dom';
import type { ReservaDelDia } from '../../servicios/panel';
import { CANALES, ESTADOS, hora as formatearHora } from '../../web/formato';
import { marcarEstado } from './acciones';

const CERRADAS = ['cancelada', 'no_show', 'finalizada'];

/**
 * Planilla del día.
 *
 * El cambio de estado se refleja en el acto, antes de que el servidor conteste. Sin
 * eso, entre el clic y la respuesta no pasa nada visible y quien está atendiendo no
 * sabe si tocó bien el botón: en un salón lleno eso termina en dos clics y una
 * reserva marcada como que no vino.
 */
export default function Tabla({ reservas, tz }: { reservas: ReservaDelDia[]; tz: string }) {
  const [optimistas, aplicar] = useOptimistic(
    reservas,
    (actual: ReservaDelDia[], cambio: { id: string; estado: string }) =>
      actual.map((r) => (r.id === cambio.id ? { ...r, estado: cambio.estado } : r)),
  );

  if (reservas.length === 0) {
    return <p className="vacio">Todavía no hay reservas para este día.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Hora</th><th>Quién</th><th>Personas</th><th>Mesa</th>
          <th>Estado</th><th>Canal</th><th />
        </tr>
      </thead>
      <tbody>
        {optimistas.map((r) => {
          const cerrada = CERRADAS.includes(r.estado);
          const cambiar = async (datos: FormData) => {
            aplicar({ id: r.id, estado: String(datos.get('estado')) });
            await marcarEstado(datos);
          };

          return (
            <tr key={r.id} className={cerrada ? 'pasada' : undefined}>
              <td><strong>{formatearHora(r.inicio, tz)}</strong></td>
              <td>
                <Link href={`/panel/reserva/${r.id}`}>{r.cliente?.nombre ?? 'Sin reserva'}</Link>
                {r.cliente && r.cliente.visitas > 0 && (
                  <div className="apagado">
                    {r.cliente.visitas} {r.cliente.visitas === 1 ? 'visita' : 'visitas'}
                    {r.cliente.noShows > 0 && ` · ${r.cliente.noShows} ausencias`}
                  </div>
                )}
                {r.sinContacto && <div className="pastilla alerta">no recibe avisos</div>}
              </td>
              <td>{r.personas}</td>
              <td>{r.mesas.join(' + ') || '—'}</td>
              <td>
                <span className={`pastilla ${cerrada ? 'gris' : ''}`}>
                  {ESTADOS[r.estado] ?? r.estado}
                </span>
              </td>
              <td className="apagado">{CANALES[r.canalOrigen] ?? r.canalOrigen}</td>
              <td>
                {!cerrada && (
                  <div className="acciones">
                    {r.estado !== 'sentada' && (
                      <Accion reservaId={r.id} estado="sentada" alEnviar={cambiar}>Llegó</Accion>
                    )}
                    {r.estado === 'sentada' && (
                      <Accion reservaId={r.id} estado="finalizada" alEnviar={cambiar}>Liberar</Accion>
                    )}
                    <Accion reservaId={r.id} estado="no_show" alEnviar={cambiar} secundario>
                      No vino
                    </Accion>
                    <Accion reservaId={r.id} estado="cancelada" alEnviar={cambiar} secundario>
                      Cancelar
                    </Accion>
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Accion({
  reservaId, estado, alEnviar, children, secundario,
}: {
  reservaId: string;
  estado: string;
  alEnviar: (datos: FormData) => Promise<void>;
  children: React.ReactNode;
  secundario?: boolean | undefined;
}) {
  return (
    <form action={alEnviar}>
      <input type="hidden" name="reservaId" value={reservaId} />
      <input type="hidden" name="estado" value={estado} />
      <Boton secundario={secundario}>{children}</Boton>
    </form>
  );
}

/** Se apaga mientras el servidor responde, para que no se pueda tocar dos veces. */
function Boton({ children, secundario }: { children: React.ReactNode; secundario?: boolean | undefined }) {
  const { pending } = useFormStatus();
  return (
    <button className={`chico ${secundario ? 'secundario' : ''}`} type="submit" disabled={pending}>
      {pending ? '…' : children}
    </button>
  );
}
