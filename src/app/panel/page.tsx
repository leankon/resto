import Link from 'next/link';
import { salir } from '../login/acciones';
import { poolApp, requerirStaff } from '../../web/contexto';
import { fechaCorta, hora as horaDe, hoyEn, instanteLocal, sumarDias } from '../../web/formato';
import {
  estadoDelSalon,
  horasDelPlano,
  ingresosPorBloque,
  reservasDelDia,
  type ReservaDelDia,
} from '../../servicios/panel';
import Plano from './plano';
import Tabla from './tabla';

type Parametros = Promise<{ fecha?: string; salon?: string; hora?: string }>;

export default async function Panel({ searchParams }: { searchParams: Parametros }) {
  const { fecha: fechaCruda, salon: salonPedido, hora: horaCruda } = await searchParams;
  const ctx = await requerirStaff();
  const esDuenio = ctx.sesion.rol === 'dueño';
  // El menú muestra solo lo que esta persona puede abrir: un botón que lleva a una
  // pantalla que te rebota es peor que no tener el botón.
  const puedeConfigurar = esDuenio || ctx.sesion.rol === 'encargado';
  const { tz } = ctx.tenant;

  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaCruda ?? '') ? fechaCruda! : hoyEn(tz);
  const horaPedida = /^\d{2}:\d{2}$/.test(horaCruda ?? '') ? horaCruda! : null;

  const [reservas, ingresos, horasPosibles] = await Promise.all([
    reservasDelDia(poolApp(), ctx.tenantId, fecha),
    ingresosPorBloque(poolApp(), ctx.tenantId, fecha),
    horasDelPlano(poolApp(), ctx.tenantId, fecha),
  ]);

  // La hora que se mira por defecto: si el día es hoy y el local está abierto, ahora
  // mismo. Si no, la primera reserva del día, que es lo que alguien quiere ver cuando
  // abre la planilla de mañana. Antes era siempre 21:00, que para un local que abre a
  // las 20:00 mostraba el salón vacío.
  const horaPlano = horaPedida ?? horaPorDefecto(fecha, tz, horasPosibles, reservas);
  const salones = await estadoDelSalon(
    poolApp(),
    ctx.tenantId,
    instanteLocal(fecha, horaPlano, tz),
  );

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
        {puedeConfigurar && (
          <>
            <Link className="boton secundario chico" href="/panel/salon">El salón</Link>
            <Link className="boton secundario chico" href="/panel/horarios">Horarios</Link>
          </>
        )}
        {esDuenio && (
          <>
            <Link className="boton secundario chico" href="/panel/publico">Reservas web</Link>
            <Link className="boton secundario chico" href="/panel/equipo">Equipo</Link>
          </>
        )}
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
          <p className="apagado" style={{ marginTop: -8 }}>
            Tocá una mesa ocupada y después una libre para mover la reserva. Queda fijada:
            el sistema no la vuelve a reacomodar solo.
          </p>
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
              {/* La hora elegida siempre aparece, aunque sea una que no está en la
                  grilla: si no, el botón marcado no existe y parece que no pasó nada. */}
              {[...new Set([...horasPosibles, horaPlano])].sort().map((h) => (
                <Link key={h} href={link({ hora: h })} aria-current={h === horaPlano ? 'page' : undefined}>
                  {h}
                </Link>
              ))}
              <form method="get" action="/panel" style={{ display: 'flex', gap: 4 }}>
                <input type="hidden" name="fecha" value={fecha} />
                {salonActivo && <input type="hidden" name="salon" value={salonActivo.id} />}
                <input
                  type="time"
                  name="hora"
                  defaultValue={horaPlano}
                  aria-label="Ver el salón a otra hora"
                  style={{ width: 118, marginTop: 0 }}
                />
                <button type="submit" className="secundario chico">Ver</button>
              </form>
            </div>
          </div>

          {salonActivo ? (
            <div className="envoltorio-plano">
              <Plano salon={salonActivo} tz={tz} hora={horaPlano} />
            </div>
          ) : (
            <p className="vacio">Este local todavía no tiene mesas cargadas.</p>
          )}
        </section>
      </main>
    </>
  );
}

/**
 * A qué hora mostrar el salón cuando nadie eligió una.
 *
 * Mirar el salón del día tiene dos usos distintos: durante el servicio, ver cómo está
 * ahora; y al preparar un día futuro, ver el primer momento en que pasa algo. Una hora
 * fija no sirve para ninguno de los dos.
 */
function horaPorDefecto(
  fecha: string,
  tz: string,
  horasPosibles: string[],
  reservas: ReservaDelDia[],
): string {
  if (fecha === hoyEn(tz)) {
    const ahora = horaDe(new Date(), tz);
    // Solo si el local está abierto: a las 9 de la mañana el salón vacío no dice nada.
    if (horasPosibles.length > 0 && ahora >= horasPosibles[0]! && ahora <= horasPosibles.at(-1)!) {
      return ahora;
    }
  }
  const primera = reservas.find((r) => !['cancelada', 'no_show'].includes(r.estado));
  if (primera) return horaDe(primera.inicio, tz);
  return horasPosibles[0] ?? '21:00';
}
