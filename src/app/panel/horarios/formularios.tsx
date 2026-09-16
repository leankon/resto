'use client';

import { Fragment, useActionState } from 'react';
import type {
  DuracionConfigurada, ExcepcionConfigurada, FranjaConfigurada,
} from '../../../servicios/configuracion';
import {
  alternarFranja,
  duracion,
  duracionPareja,
  eliminarDuracion,
  eliminarExcepcion,
  eliminarFranja,
  excepcion,
  franja,
  guardarNombre,
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

export function Excepciones({ excepciones }: { excepciones: ExcepcionConfigurada[] }) {
  const [error, enviar, enviando] = useActionState(excepcion, null);

  return (
    <>
      {error && <p className="aviso">{error}</p>}
      {excepciones.length > 0 && (
        <table>
          <tbody>
            {excepciones.map((e) => (
              <tr key={e.id}>
                <td style={{ width: 120 }}><strong>{e.fecha}</strong></td>
                <td>
                  {e.cerrado
                    ? <span className="pastilla alerta">Cerrado</span>
                    : <>Abre de {e.desde} a {e.hasta}</>}
                  {e.motivo && <span className="apagado"> · {e.motivo}</span>}
                </td>
                <td>
                  <form action={eliminarExcepcion}>
                    <input type="hidden" name="excepcionId" value={e.id} />
                    <button className="secundario chico" type="submit">Quitar</button>
                  </form>
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
          <input type="checkbox" name="cerrado" defaultChecked
                 style={{ width: 'auto', margin: 0 }} />
          Cerrado
        </label>
        <label style={{ flex: '0 1 110px' }}>
          Si abre, desde
          <input type="time" name="desde" />
        </label>
        <label style={{ flex: '0 1 110px' }}>
          Hasta
          <input type="time" name="hasta" />
        </label>
        <label style={{ flex: '1 1 160px' }}>
          Motivo
          <input name="motivo" placeholder="Feriado, evento privado…" />
        </label>
        <div style={{ flex: '0 0 auto' }}>
          <button type="submit" disabled={enviando}>Agregar</button>
        </div>
      </form>
      <p className="apagado">
        Un día marcado como cerrado deja de aceptar reservas, por web y por mostrador.
        Si esa noche el servicio termina después de medianoche, la madrugada siguiente
        también queda cerrada.
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
