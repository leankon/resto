import Link from 'next/link';
import { notFound } from 'next/navigation';
import { poolApp, requerirStaff } from '../../../../web/contexto';
import { CANALES, ESTADOS, fechaCorta, hora } from '../../../../web/formato';
import { estadoDelSalon, historial, reservaPorId } from '../../../../servicios/panel';
import { telefonoLegible } from '../../../../dominio/clientes';
import Mover from './mover';

const DESCRIPCION: Record<string, string> = {
  creada: 'Se cargó la reserva',
  asignada_auto: 'El sistema asignó la mesa',
  reasignada_manual: 'Alguien la cambió de mesa',
  walk_in: 'Entró sin reserva',
  sentada: 'Llegó',
  finalizada: 'Se liberó la mesa',
  cancelada: 'Se canceló',
  no_show: 'No vino',
  en_riesgo: 'No confirmó el recordatorio',
};

export default async function DetalleReserva({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requerirStaff();
  const { tz } = ctx.tenant;

  const [reserva, eventos] = await Promise.all([
    reservaPorId(poolApp(), ctx.tenantId, id),
    historial(poolApp(), ctx.tenantId, id),
  ]);
  if (!reserva) notFound();

  // El día al que pertenece la reserva en hora local: el botón "volver" tiene que
  // llevar a la planilla donde está, no a la de hoy.
  const fecha = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(reserva.inicio);

  const salones = await estadoDelSalon(poolApp(), ctx.tenantId, reserva.inicio);

  return (
    <>
      <header className="barra">
        <span className="marca">{ctx.tenant.nombre}</span>
        <Link className="boton secundario chico" href={`/panel?fecha=${fecha}`}>Volver al día</Link>
      </header>

      <main className="contenido angosto">
        <h1 style={{ fontSize: 20, margin: '4px 0 4px' }}>
          {reserva.cliente?.nombre ?? 'Sin reserva'}
        </h1>
        <p className="apagado" style={{ marginTop: 0 }}>
          {fechaCorta(reserva.inicio, tz)} · {hora(reserva.inicio, tz)} ·{' '}
          {reserva.personas} {reserva.personas === 1 ? 'persona' : 'personas'}
        </p>

        <section className="tarjeta">
          <h2>Datos</h2>
          <table>
            <tbody>
              <tr><td>Estado</td><td><span className="pastilla">{ESTADOS[reserva.estado]}</span></td></tr>
              <tr><td>Mesa</td><td>{reserva.mesas.join(' + ') || '—'} {reserva.salon && <span className="apagado">· {reserva.salon}</span>}</td></tr>
              <tr><td>Vino por</td><td>{CANALES[reserva.canalOrigen]}</td></tr>
              <tr>
                <td>Contacto</td>
                <td>
                  {telefonoLegible(reserva.cliente?.telefono)}
                  {reserva.cliente?.telefono && reserva.cliente?.email ? ' · ' : ''}
                  {reserva.cliente?.email ?? ''}
                  {reserva.sinContacto && <span className="pastilla alerta">no recibe avisos</span>}
                  {!reserva.cliente && <span className="apagado">sin cliente asociado</span>}
                </td>
              </tr>
              {reserva.cliente && (
                <tr>
                  <td>Historial acá</td>
                  <td>
                    {reserva.cliente.visitas} {reserva.cliente.visitas === 1 ? 'visita' : 'visitas'}
                    {reserva.cliente.noShows > 0 && ` · ${reserva.cliente.noShows} ausencias`}
                  </td>
                </tr>
              )}
              {reserva.notas && <tr><td>Notas</td><td>{reserva.notas}</td></tr>}
            </tbody>
          </table>
        </section>

        <Mover reservaId={reserva.id} salones={salones} actuales={reserva.mesas} />

        <section className="tarjeta">
          <h2>Qué pasó con esta reserva</h2>
          <table>
            <tbody>
              {eventos.map((e, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{hora(e.en, tz)}</td>
                  <td>
                    {DESCRIPCION[e.tipo] ?? e.tipo}
                    {e.tipo === 'reasignada_manual' && (
                      <div className="apagado">
                        {String((e.datos as { antes?: string[] }).antes?.join(' + '))} →{' '}
                        {String((e.datos as { despues?: string[] }).despues?.join(' + '))}
                        {(e.datos as { motivo?: string }).motivo
                          ? ` · ${(e.datos as { motivo?: string }).motivo}`
                          : ''}
                      </div>
                    )}
                  </td>
                  <td className="apagado">{e.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
