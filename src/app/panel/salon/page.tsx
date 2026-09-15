import Link from 'next/link';
import { poolApp, requerirEncargado } from '../../../web/contexto';
import { cargarPlanoCompleto } from '../../../servicios/plano';
import Lienzo from './lienzo';
import { AgregarMesa, AgregarSalon, BorrarSalon, TablaMesas } from './formularios';
import { cambiarRadio, desvetar, medidasDesdeFormulario, vetar } from './acciones';

export default async function Salon({
  searchParams,
}: {
  searchParams: Promise<{ salon?: string }>;
}) {
  const { salon: pedido } = await searchParams;
  const ctx = await requerirEncargado();
  const plano = await cargarPlanoCompleto(poolApp(), ctx.tenantId);
  const activo = plano.salones.find((s) => s.id === pedido) ?? plano.salones[0];
  const radio = plano.config.radioCombinacionCm;

  const deEsteSalon = activo
    ? plano.combinaciones.filter((c) => c.mesas.every((id) => activo.mesas.some((m) => m.id === id)))
    : [];
  const noSeUnenAca = activo
    ? plano.noSeUnen.filter((p) => p.salonId === activo.id)
    : [];

  return (
    <>
      <header className="barra">
        <span className="marca">{ctx.tenant.nombre}</span>
        <Link className="boton secundario chico" href="/panel/horarios">Horarios</Link>
        <Link className="boton secundario chico" href="/panel">Volver al día</Link>
      </header>

      <main className="contenido">
        <h1 style={{ fontSize: 20, margin: '4px 0 6px' }}>El salón</h1>
        <p className="apagado" style={{ marginTop: 0 }}>
          Lo que cargues acá es de donde el sistema saca las mesas para asignar. No hace falta
          que cargues qué mesas se pueden juntar: eso lo deduce de dónde están.
        </p>

        <div className="solapas">
          {plano.salones.map((s) => (
            <Link
              key={s.id}
              href={`/panel/salon?salon=${s.id}`}
              aria-current={s.id === activo?.id ? 'page' : undefined}
            >
              {s.nombre} <span className="apagado">· {s.mesas.length}</span>
            </Link>
          ))}
        </div>

        {activo && (
          <>
            <section className="tarjeta">
              <h2>{activo.nombre}</h2>
              <Lienzo
                salonId={activo.id}
                anchoCm={activo.anchoCm}
                altoCm={activo.altoCm}
                mesas={activo.mesas}
                radioCm={radio}
                vetadas={plano.vetadas}
              />

              <form action={medidasDesdeFormulario} className="fila" style={{ marginTop: 12 }}>
                <input type="hidden" name="salonId" value={activo.id} />
                <label style={{ flex: '0 1 150px' }}>
                  Ancho del salón (m)
                  <input type="number" name="anchoM" min={2} max={100} step={0.5}
                         defaultValue={activo.anchoCm / 100} />
                </label>
                <label style={{ flex: '0 1 150px' }}>
                  Largo del salón (m)
                  <input type="number" name="altoM" min={2} max={100} step={0.5}
                         defaultValue={activo.altoCm / 100} />
                </label>
                <div style={{ flex: '0 0 auto' }}>
                  <button className="secundario" type="submit">Cambiar medidas</button>
                </div>
              </form>

              <form action={cambiarRadio} className="fila" style={{ marginTop: 14 }}>
                <label style={{ flex: '1 1 260px' }}>
                  Hasta qué distancia se pueden arrimar dos mesas
                  <input type="number" name="radio" min={50} max={1000} step={10}
                         defaultValue={radio} />
                </label>
                <div style={{ flex: '0 0 auto' }}>
                  <button className="secundario" type="submit">Cambiar</button>
                </div>
              </form>
              <p className="apagado" style={{ marginTop: -6 }}>
                En centímetros. Subilo si tu salón es holgado y las mesas se mueven fácil;
                bajalo si acercar dos mesas molesta el paso.
              </p>
            </section>

            <section className="tarjeta editor-mesas">
              <h2>Mesas de {activo.nombre}</h2>
              <TablaMesas mesas={activo.mesas} />
              <AgregarMesa salonId={activo.id} anchoCm={activo.anchoCm} altoCm={activo.altoCm} />
            </section>

            <section className="tarjeta">
              <h2>Lo que el sistema va a poder unir</h2>
              {deEsteSalon.length === 0 ? (
                <p className="vacio">
                  Ninguna combinación por ahora. Acercá dos mesas a menos de {radio} cm.
                </p>
              ) : (
                <table>
                  <thead>
                    <tr><th>Mesas</th><th>Personas</th><th>Hay que arrimar</th><th /></tr>
                  </thead>
                  <tbody>
                    {deEsteSalon.map((c) => (
                      <tr key={c.clave}>
                        <td><strong>{c.etiqueta}</strong></td>
                        <td>{c.capacidad}</td>
                        <td className="apagado">{(c.distanciaCm / 100).toFixed(2)} m</td>
                        <td>
                          {c.mesas.length === 2 && (
                            <form action={vetar}>
                              <input type="hidden" name="mesaA" value={c.mesas[0]} />
                              <input type="hidden" name="mesaB" value={c.mesas[1]} />
                              <button className="secundario chico" type="submit">
                                No se pueden unir
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="apagado">
                Están cerca, así que el sistema las va a ofrecer juntas para grupos grandes.
                Si en la práctica alguna no se puede (hay una columna, tapan el paso al baño),
                marcala y deja de proponerla.
              </p>
            </section>

            {noSeUnenAca.length > 0 && (
              <section className="tarjeta">
                <h2>Por qué estas no se unen</h2>
                <table>
                  <tbody>
                    {noSeUnenAca.map((p) => (
                      <tr key={p.etiqueta}>
                        <td style={{ width: 120 }}><strong>{p.etiqueta}</strong></td>
                        <td>{p.motivo}</td>
                        <td className="apagado" style={{ whiteSpace: 'nowrap' }}>
                          {(p.separacionCm / 100).toFixed(2)} m
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="apagado">
                  La distancia se mide entre los bordes, no entre los centros: es cuánto hay
                  que arrimarlas para que se toquen.
                </p>
              </section>
            )}
          </>
        )}

        {plano.vetadas.length > 0 && (
          <section className="tarjeta">
            <h2>Marcadas como imposibles de unir</h2>
            <table>
              <tbody>
                {plano.vetadas.map((v) => (
                  <tr key={`${v.mesaA}-${v.mesaB}`}>
                    <td><strong>{v.nombreA} + {v.nombreB}</strong></td>
                    <td>
                      <form action={desvetar}>
                        <input type="hidden" name="mesaA" value={v.mesaA} />
                        <input type="hidden" name="mesaB" value={v.mesaB} />
                        <button className="secundario chico" type="submit">Permitir de nuevo</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {activo && activo.mesas.length === 0 && (
          <BorrarSalon salonId={activo.id} nombre={activo.nombre} />
        )}

        <section className="tarjeta">
          <h2>Otro salón o piso</h2>
          <AgregarSalon />
        </section>
      </main>
    </>
  );
}
