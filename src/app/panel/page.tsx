import Link from 'next/link';
import { salir } from '../login/acciones';
import { poolApp, requerirStaff } from '../../web/contexto';
import { fechaCorta, hoyEn, instanteLocal, sumarDias } from '../../web/formato';
import { estadoDelSalon, ingresosPorBloque, reservasDelDia } from '../../servicios/panel';
import Tabla from './tabla';

type Parametros = Promise<{ fecha?: string; salon?: string; hora?: string }>;

export default async function Panel({ searchParams }: { searchParams: Parametros }) {
  const { fecha: fechaCruda, salon: salonPedido, hora: horaPedida } = await searchParams;
  const ctx = await requerirStaff();
  const { tz } = ctx.tenant;

  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaCruda ?? '') ? fechaCruda! : hoyEn(tz);
  const horaPlano = /^\d{2}:\d{2}$/.test(horaPedida ?? '') ? horaPedida! : '21:00';

  const [reservas, ingresos, salones] = await Promise.all([
    reservasDelDia(poolApp(), ctx.tenantId, fecha),
    ingresosPorBloque(poolApp(), ctx.tenantId, fecha),
    estadoDelSalon(poolApp(), ctx.tenantId, instanteLocal(fecha, horaPlano, tz)),
  ]);

  const salonActivo = salones.find((s) => s.id === salonPedido) ?? salones[0];
  const pico = Math.max(1, ...ingresos.map((i) => i.personas));
  const comensales = reservas
    .filter((r) => !['cancelada', 'no_show'].includes(r.estado))
    .reduce((total, r) => total + r.personas, 0);
  const link = (extra: Record<string, string>) =>
    `/panel?${new URLSearchParams({ fecha, hora: horaPlano, ...(salonActivo ? { salon: salonActivo.id } : {}), ...extra })}`;

  return (
    <>
      <header className="barra">
        <span className="marca">{ctx.tenant.nombre}</span>
        <Link className="boton chico" href={`/panel/nueva?fecha=${fecha}`}>
          Nueva reserva
        </Link>
        <span className="quien">{ctx.sesion.nombre}</span>
        <form action={salir}>
          <button className="secundario chico" type="submit">Salir</button>
        </form>
      </header>

      <main className="contenido">
        <div className="fila" style={{ marginBottom: 18, alignItems: 'center' }}>
          <div style={{ flex: '2 1 280px' }}>
            <div style={{ fontSize: 19, fontWeight: 650 }}>
              {fechaCorta(new Date(`${fecha}T12:00:00Z`), 'UTC')}
            </div>
            <div className="apagado">
              {reservas.length} {reservas.length === 1 ? 'reserva' : 'reservas'} · {comensales} cubiertos
            </div>
          </div>
          <div className="acciones" style={{ flex: '0 0 auto', justifyContent: 'flex-end' }}>
            <Link className="boton secundario chico" href={link({ fecha: sumarDias(fecha, -1) })}>
              ← Día anterior
            </Link>
            <Link className="boton secundario chico" href={link({ fecha: hoyEn(tz) })}>Hoy</Link>
            <Link className="boton secundario chico" href={link({ fecha: sumarDias(fecha, 1) })}>
              Día siguiente →
            </Link>
          </div>
        </div>

        {ingresos.length > 0 && (
          <section className="tarjeta">
            {/* Decidimos no frenar reservas por capacidad de cocina, pero el encargado
                necesita ver venir el pico igual. */}
            <h2>Cómo entra la gente</h2>
            <p className="apagado" style={{ marginTop: -8 }}>
              Personas por cada quince minutos. El sistema no frena reservas por esto,
              pero el pico conviene verlo venir.
            </p>
            <div className="ingresos">
              {ingresos.map((bloque) => (
                <div className="bloque" key={bloque.hora} title={`${bloque.reservas} reservas`}>
                  <div className="cifra">{bloque.personas}</div>
                  <div
                    className="barrita"
                    style={{ height: `${Math.round((bloque.personas / pico) * 78)}%` }}
                  />
                  <div className="etiqueta">{bloque.hora}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="tarjeta">
          <h2>Reservas del día</h2>
          <Tabla reservas={reservas} tz={tz} />
        </section>

        <section className="tarjeta">
          <h2>El salón a las {horaPlano}</h2>
          <div className="fila" style={{ marginBottom: 14 }}>
            <div className="solapas" style={{ margin: 0, flex: '1 1 auto' }}>
              {salones.map((s) => (
                <Link
                  key={s.id}
                  href={link({ salon: s.id })}
                  aria-current={s.id === salonActivo?.id ? 'page' : undefined}
                >
                  {s.nombre}
                </Link>
              ))}
            </div>
            <div className="solapas" style={{ margin: 0, flex: '0 0 auto' }}>
              {['13:00', '20:30', '21:00', '21:30', '22:00', '23:00'].map((h) => (
                <Link key={h} href={link({ hora: h })} aria-current={h === horaPlano ? 'page' : undefined}>
                  {h}
                </Link>
              ))}
            </div>
          </div>

          <div className="mesas">
            {salonActivo?.mesas.map((m) => (
              <div key={m.id} className={`mesa ${m.ocupadaPor ? 'ocupada' : ''}`}>
                <div className="nombre">{m.nombre}</div>
                <div className="detalle">
                  {m.capacidadBase}
                  {m.cabeceras > 0 && `–${m.capacidadBase + m.cabeceras}`} lugares
                </div>
                <div className="detalle">
                  {m.ocupadaPor
                    ? `${m.ocupadaPor.cliente ?? 'Sin reserva'} · ${m.ocupadaPor.personas}`
                    : 'libre'}
                </div>
              </div>
            ))}
          </div>
          {!salonActivo && <p className="vacio">Este local todavía no tiene mesas cargadas.</p>}
        </section>
      </main>
    </>
  );
}
