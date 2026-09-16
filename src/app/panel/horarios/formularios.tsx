'use client';

import { Fragment, useActionState, useState } from 'react';
import type {
  DiaDeLaSemana, DuracionConfigurada, ExcepcionConfigurada, FranjaConfigurada,
} from '../../../servicios/configuracion';
import {
  alternarFranja,
  cerrarUnDia,
  copiarDia,
  duracion,
  duracionPareja,
  eliminarDuracion,
  eliminarExcepcion,
  eliminarFranja,
  excepcion,
  franja,
  guardarNombre,
  horarioDeUnDia,
} from './acciones';

const DIAS: [number, string][] = [
  [1, 'Lu'], [2, 'Ma'], [3, 'Mi'], [4, 'Ju'], [5, 'Vi'], [6, 'Sá'], [0, 'Do'],
];

const conMensaje = (accion: (datos: FormData) => Promise<string | null>) =>
  async (_previo: string | null, datos: FormData) => accion(datos);

export function NombreDelLocal({ nombre }: { nombre: string }) {
  const [error, enviar, enviando] = useActionState(guardarNombre, null);
  return (
    <form action={enviar} className="fila">
      {error && <p className="aviso" style={{ flexBasis: '100%' }}>{error}</p>}
      <label style={{ flex: '1 1 260px' }}>
        Nombre del local
        <input name="nombre" defaultValue={nombre} required />
      </label>
      <div style={{ flex: '0 0 auto' }}>
        <button className="secundario" type="submit" disabled={enviando}>Guardar</button>
      </div>
    </form>
  );
}

/**
 * `idForm` solo va cuando los días viven fuera de su formulario, en una fila de la tabla.
 * Cuando no va, el atributo se omite entero: `form=""` no asocia el campo al formulario
 * que lo contiene, lo deja suelto, y los días no se envían.
 */
function Dias({ dias, idForm }: { dias: number[]; idForm?: string }) {
  return (
    <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      {DIAS.map(([valor, texto]) => (
        <label key={valor} className="dia" title={texto}>
          <input
            {...(idForm ? { form: idForm } : {})}
            type="checkbox" name="dias" value={valor}
            defaultChecked={dias.includes(valor)}
          />
          <span>{texto}</span>
        </label>
      ))}
    </div>
  );
}

export function Franjas({ franjas }: { franjas: FranjaConfigurada[] }) {
  const [error, enviar, enviando] = useActionState(franja, null);
  const [errorBorrado, borrar] = useActionState(conMensaje(eliminarFranja), null);
  const aviso = error ?? errorBorrado;

  return (
    <>
      {aviso && <p className="aviso">{aviso}</p>}
      {franjas.length > 0 && (
        <table className="editor-mesas">
          <thead>
            <tr>
              <th>Nombre</th><th>Días</th><th>Abre</th><th>Cierra</th>
              <th>Último ingreso</th><th /><th />
            </tr>
          </thead>
          <tbody>
            {franjas.map((f) => (
              <tr key={f.id} className={f.activa ? undefined : 'pasada'}>
                <td>
                  <input form={`f-${f.id}`} name="nombre" defaultValue={f.nombre}
                         required style={{ width: 110 }} />
                </td>
                <td><Dias dias={f.dias} idForm={`f-${f.id}`} /></td>
                <td>
                  <input form={`f-${f.id}`} type="time" name="desde" defaultValue={f.desde} />
                </td>
                <td>
                  <input form={`f-${f.id}`} type="time" name="hasta" defaultValue={f.hasta} />
                  {f.cruzaMedianoche && (
                    <div className="apagado" style={{ fontSize: 11 }}>del día siguiente</div>
                  )}
                </td>
                <td>
                  <input form={`f-${f.id}`} type="time" name="ultimoIngreso"
                         defaultValue={f.ultimoIngreso} />
                </td>
                <td>
                  <button form={`f-${f.id}`} className="secundario chico" type="submit"
                          disabled={enviando}>
                    Guardar
                  </button>
                </td>
                <td>
                  <div className="acciones">
                    <button form={`fa-${f.id}`} className="secundario chico" type="submit">
                      {f.activa ? 'Desactivar' : 'Activar'}
                    </button>
                    <button form={`fb-${f.id}`} className="secundario chico" type="submit">
                      Borrar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {franjas.map((f) => (
        <Fragment key={f.id}>
          <form id={`f-${f.id}`} action={enviar} hidden>
            <input type="hidden" name="franjaId" value={f.id} />
          </form>
          <form id={`fa-${f.id}`} action={alternarFranja} hidden>
            <input type="hidden" name="franjaId" value={f.id} />
            <input type="hidden" name="activa" value={f.activa ? 'no' : 'si'} />
          </form>
          <form id={`fb-${f.id}`} action={borrar} hidden>
            <input type="hidden" name="franjaId" value={f.id} />
          </form>
        </Fragment>
      ))}

      <form action={enviar} className="fila" style={{ marginTop: 16 }}>
        <label style={{ flex: '1 1 130px' }}>
          Nueva franja
          <input name="nombre" placeholder="Almuerzo, Cena, Brunch…" required />
        </label>
        <div style={{ flex: '0 1 auto' }}>
          <span className="apagado" style={{ fontSize: 13 }}>Días</span>
          <Dias dias={[1, 2, 3, 4, 5, 6, 0]} />
        </div>
        <label style={{ flex: '0 1 110px' }}>
          Abre
          <input type="time" name="desde" defaultValue="20:00" required />
        </label>
        <label style={{ flex: '0 1 110px' }}>
          Cierra
          <input type="time" name="hasta" defaultValue="23:59" required />
        </label>
        <label style={{ flex: '0 1 130px' }}>
          Último ingreso
          <input type="time" name="ultimoIngreso" defaultValue="23:00" required />
        </label>
        <div style={{ flex: '0 0 auto' }}>
          <button type="submit" disabled={enviando}>Agregar</button>
        </div>
      </form>
      <p className="apagado">
        Si la franja cierra después de medianoche, poné la hora de cierre igual: una cena
        de 20:00 a 02:00 se entiende sola, y la reserva de la 01:00 cuenta como parte de
        la noche anterior.
      </p>
    </>
  );
}

export function Duraciones({
  duraciones, franjas,
}: {
  duraciones: DuracionConfigurada[];
  franjas: FranjaConfigurada[];
}) {
  const [error, enviar, enviando] = useActionState(duracion, null);

  // Igual que con los días: sin `idForm` el atributo no se pone, porque `form=""`
  // desasocia el campo en vez de dejarlo en el formulario que lo contiene.
  const selectorDeFranja = (idForm: string | undefined, valor: string | null) => (
    <select {...(idForm ? { form: idForm } : {})} name="franja" defaultValue={valor ?? ''}>
      <option value="">Cualquiera</option>
      {franjas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
    </select>
  );

  return (
    <>
      {error && <p className="aviso">{error}</p>}
      <TodasIguales />
      {duraciones.length > 0 && (
        <table className="editor-mesas">
          <thead>
            <tr>
              <th>Franja</th><th>Desde</th><th>Hasta</th>
              <th>Dura (min)</th><th>Limpieza (min)</th><th /><th />
            </tr>
          </thead>
          <tbody>
            {duraciones.map((d) => (
              <tr key={d.id}>
                <td>{selectorDeFranja(`d-${d.id}`, d.franjaId)}</td>
                <td>
                  <input form={`d-${d.id}`} className="angosto" type="number" name="personasMin"
                         min={1} defaultValue={d.personasMin} />
                </td>
                <td>
                  <input form={`d-${d.id}`} className="angosto" type="number" name="personasMax"
                         min={1} defaultValue={d.personasMax} />
                </td>
                <td>
                  <input form={`d-${d.id}`} className="angosto" type="number" name="duracionMin"
                         min={15} max={600} step={5} defaultValue={d.duracionMin} />
                </td>
                <td>
                  <input form={`d-${d.id}`} className="angosto" type="number" name="bufferMin"
                         min={0} max={120} step={5} defaultValue={d.bufferMin} />
                </td>
                <td>
                  <button form={`d-${d.id}`} className="secundario chico" type="submit"
                          disabled={enviando}>
                    Guardar
                  </button>
                </td>
                <td>
                  <button form={`db-${d.id}`} className="secundario chico" type="submit">
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {duraciones.map((d) => (
        <Fragment key={d.id}>
          <form id={`d-${d.id}`} action={enviar} hidden>
            <input type="hidden" name="duracionId" value={d.id} />
          </form>
          <form id={`db-${d.id}`} action={eliminarDuracion} hidden>
            <input type="hidden" name="duracionId" value={d.id} />
          </form>
        </Fragment>
      ))}

      <form action={enviar} className="fila" style={{ marginTop: 16 }}>
        <label style={{ flex: '0 1 160px' }}>
          Franja
          {selectorDeFranja(undefined, null)}
        </label>
        <label className="angosto">
          Desde
          <input type="number" name="personasMin" min={1} defaultValue={1} required />
        </label>
        <label className="angosto">
          Hasta
          <input type="number" name="personasMax" min={1} defaultValue={2} required />
        </label>
        <label className="angosto">
          Dura
          <input type="number" name="duracionMin" min={15} max={600} step={5}
                 defaultValue={90} required />
        </label>
        <label className="angosto">
          Limpieza
          <input type="number" name="bufferMin" min={0} max={120} step={5} defaultValue={0} />
        </label>
        <div style={{ flex: '0 0 auto' }}>
          <button type="submit" disabled={enviando}>Agregar</button>
        </div>
      </form>
      <p className="apagado">
        Cuánto ocupa la mesa un grupo de ese tamaño, más el tiempo de limpieza antes de la
        siguiente reserva. "Cualquiera" en la franja es el comodín: se usa cuando no hay
        una regla específica, así una franja nueva nunca se queda sin duración.
      </p>
    </>
  );
}

/**
 * Días que se salen de la rutina.
 *
 * Un día especial REEMPLAZA el horario de esa fecha: por eso puede abrir antes de lo
 * normal, abrir menos, o abrir un día en el que el local normalmente cierra. Una fecha
 * admite varios tramos —brunch y cena, por ejemplo—; "cerrado" es excluyente.
 */
export function Excepciones({
  excepciones,
  franjas,
}: {
  excepciones: ExcepcionConfigurada[];
  franjas: FranjaConfigurada[];
}) {
  const [error, enviar, enviando] = useActionState(excepcion, null);
  const [cerrado, setCerrado] = useState(true);

  // Agrupadas por fecha: un día con brunch y cena son dos filas de lo mismo, y verlas
  // sueltas obliga a reconstruir mentalmente cómo queda ese día.
  const porFecha = new Map<string, ExcepcionConfigurada[]>();
  for (const e of excepciones) {
    const lista = porFecha.get(e.fecha);
    if (lista) lista.push(e);
    else porFecha.set(e.fecha, [e]);
  }

  return (
    <>
      {error && <p className="aviso">{error}</p>}
      {porFecha.size > 0 && (
        <table>
          <tbody>
            {[...porFecha].map(([fecha, delDia]) => (
              <tr key={fecha}>
                <td style={{ width: 120, verticalAlign: 'top' }}>
                  <strong>{fecha}</strong>
                </td>
                <td>
                  {delDia.map((e) => (
                    <div key={e.id} style={{ marginBottom: 4 }}>
                      {e.cerrado ? (
                        <span className="pastilla alerta">Cerrado todo el día</span>
                      ) : (
                        <>
                          Abre de <strong>{e.desde}</strong> a <strong>{e.hasta}</strong>
                          {e.ultimoIngreso && (
                            <span className="apagado"> · último ingreso {e.ultimoIngreso}</span>
                          )}
                        </>
                      )}
                      {e.motivo && <span className="apagado"> · {e.motivo}</span>}{' '}
                      <form action={eliminarExcepcion} style={{ display: 'inline' }}>
                        <input type="hidden" name="excepcionId" value={e.id} />
                        <button className="secundario chico" type="submit">Quitar</button>
                      </form>
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form action={enviar} className="fila" style={{ marginTop: 14 }}>
        <label style={{ flex: '0 1 160px' }}>
          Día
          <input type="date" name="fecha" required />
        </label>
        <label style={{ flex: '0 0 auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            name="cerrado"
            defaultChecked
            onChange={(e) => setCerrado(e.target.checked)}
            style={{ width: 'auto', margin: 0 }}
          />
          Cerrado todo el día
        </label>
        {!cerrado && (
          <>
            <label style={{ flex: '0 1 105px' }}>
              Abre
              <input type="time" name="desde" required />
            </label>
            <label style={{ flex: '0 1 105px' }}>
              Cierra
              <input type="time" name="hasta" required />
            </label>
            <label style={{ flex: '0 1 125px' }}>
              Último ingreso
              <input type="time" name="ultimoIngreso" />
            </label>
            <label style={{ flex: '0 1 150px' }}>
              Turnos como
              <select name="franja" defaultValue="">
                <option value="">Los de siempre</option>
                {franjas.map((f) => (
                  <option key={f.id} value={f.id}>{f.nombre}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <label style={{ flex: '1 1 150px' }}>
          Motivo
          <input name="motivo" placeholder="Feriado, evento, Navidad…" />
        </label>
        <div style={{ flex: '0 0 auto' }}>
          <button type="submit" disabled={enviando}>Agregar</button>
        </div>
      </form>

      <p className="apagado">
        Ese día el horario especial <strong>reemplaza</strong> al de siempre: podés abrir
        antes, abrir menos, o abrir un día en el que normalmente cerrás. Si el local abre
        en dos tandas, cargá una fila por cada una. Un día marcado como cerrado deja de
        aceptar reservas por web y por mostrador, y si esa noche el servicio termina
        después de medianoche, la madrugada siguiente también queda cerrada.
      </p>
    </>
  );
}

/**
 * El atajo para el local que trabaja con turnos parejos.
 *
 * Las reglas por tamaño de grupo siguen estando y se pueden afinar después; esto fija
 * el punto de partida sin tener que editar doce filas de a una, que es donde se cuela
 * el error que deja un solo tamaño de grupo rotando distinto.
 */
function TodasIguales() {
  const [error, enviar, enviando] = useActionState(duracionPareja, null);

  return (
    <form action={enviar} className="fila" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
      {error && <p className="aviso" style={{ flexBasis: '100%' }}>{error}</p>}
      <label style={{ flex: '0 0 auto' }}>
        Poner todos los turnos en
        <input className="angosto" type="number" name="duracionMin" min={15} max={600}
               step={15} defaultValue={120} />
      </label>
      <label style={{ flex: '0 0 auto' }}>
        minutos, con limpieza de
        <input className="angosto" type="number" name="bufferMin" min={0} max={120}
               step={5} defaultValue={0} />
      </label>
      <button type="submit" className="secundario chico" disabled={enviando}
              style={{ flex: '0 0 auto' }}>
        {enviando ? 'Aplicando…' : 'Aplicar a todos'}
      </button>
    </form>
  );
}

/**
 * El horario visto día por día, como el cartel de la puerta.
 *
 * Las franjas se guardan agrupadas ("Cena, todos los días"), que es compacto pero obliga
 * a reconstruir mentalmente cómo queda cada día. Acá se da vuelta: siete filas.
 *
 * Cambiar las horas de un día que comparte franja con otros **parte la franja**: el
 * viernes se muda a una propia y los demás días quedan como estaban. Es lo que espera
 * quien dice "los viernes abrimos más tarde".
 */
export function Semana({ semana }: { semana: DiaDeLaSemana[] }) {
  const [error, enviar, enviando] = useActionState(horarioDeUnDia, null);
  const [errorCopia, copiar] = useActionState(copiarDia, null);
  const aviso = error ?? errorCopia;

  const abiertos = semana.filter((d) => d.tramos.length > 0);

  return (
    <>
      {aviso && <p className="aviso">{aviso}</p>}
      <table className="editor-mesas semana">
        <tbody>
          {semana.map((d) => (
            <tr key={d.dia}>
              <td style={{ width: 110, verticalAlign: 'top', paddingTop: 12 }}>
                <strong>{d.nombre}</strong>
              </td>
              <td>
                {d.tramos.length === 0 ? (
                  <div className="fila" style={{ alignItems: 'center' }}>
                    <span className="pastilla gris" style={{ flex: '0 0 auto' }}>Cerrado</span>
                    {abiertos.length > 0 && (
                      <form action={copiar} className="fila" style={{ flex: '0 1 auto', gap: 6 }}>
                        <input type="hidden" name="destino" value={d.dia} />
                        <select name="origen" defaultValue={abiertos[0]!.dia} style={{ width: 'auto' }}>
                          {abiertos.map((o) => (
                            <option key={o.dia} value={o.dia}>Como el {o.nombre.toLowerCase()}</option>
                          ))}
                        </select>
                        <button className="secundario chico" type="submit">Abrir</button>
                      </form>
                    )}
                  </div>
                ) : (
                  d.tramos.map((t) => (
                    <form
                      key={`${d.dia}-${t.franjaId}`}
                      action={enviar}
                      className="fila tramo"
                      style={{ alignItems: 'center' }}
                    >
                      <input type="hidden" name="franjaId" value={t.franjaId} />
                      <input type="hidden" name="dia" value={d.dia} />
                      <span style={{ flex: '0 0 92px' }}>{t.nombre}</span>
                      <input
                        type="time" name="desde" defaultValue={t.desde}
                        aria-label={`${d.nombre}, ${t.nombre}: abre`}
                        style={{ flex: '0 0 108px' }}
                      />
                      <span className="apagado" style={{ flex: '0 0 auto' }}>a</span>
                      <input
                        type="time" name="hasta" defaultValue={t.hasta}
                        aria-label={`${d.nombre}, ${t.nombre}: cierra`}
                        style={{ flex: '0 0 108px' }}
                      />
                      <span className="apagado" style={{ flex: '0 0 auto' }}>
                        {t.cruzaMedianoche ? 'del día siguiente · último ingreso' : '· último ingreso'}
                      </span>
                      <input
                        type="time" name="ultimoIngreso" defaultValue={t.ultimoIngreso}
                        aria-label={`${d.nombre}, ${t.nombre}: último ingreso`}
                        style={{ flex: '0 0 108px' }}
                      />
                      <button className="secundario chico" type="submit" disabled={enviando}
                              style={{ flex: '0 0 auto' }}>
                        Guardar
                      </button>
                      <button
                        className="secundario chico" type="submit" formAction={cerrarUnDia}
                        style={{ flex: '0 0 auto' }}
                        title={`Sacar ${t.nombre} del ${d.nombre.toLowerCase()}`}
                      >
                        Quitar
                      </button>
                    </form>
                  ))
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="apagado">
        Cambiar las horas de un día que comparte horario con otros lo separa: el resto de
        la semana queda como estaba. Un día sin ningún tramo es un día cerrado.
      </p>
    </>
  );
}
