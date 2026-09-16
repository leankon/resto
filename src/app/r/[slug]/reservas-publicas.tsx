import Link from 'next/link';
import { fechaCorta, hora as horaDe } from '../../../web/formato';
import { hoyEn, instanteLocal, sumarDias } from '../../../dominio/tiempo';
import { poolApp } from '../../../web/contexto';
import { disponibilidad, type LocalPublico } from '../../../servicios/publico';
import Confirmacion from './confirmacion';

export interface Parametros {
  fecha?: string;
  personas?: string;
  hora?: string;
}

const esFecha = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const esHora = (v: string | undefined) => !!v && /^\d{2}:\d{2}$/.test(v);

/**
 * El flujo entero de reserva, manejado por la URL y no por estado del navegador.
 *
 * Elegir día y personas, ver horarios, elegir uno y dejar los datos son cuatro pasos
 * que viven en la query string. Es a propósito: la página anda con el botón "atrás",
 * se puede compartir un link con día y hora ya elegidos, y no depende de que el
 * JavaScript cargue bien en el teléfono de alguien con dos rayas de señal.
 */
export default async function ReservasPublicas({
  local,
  parametros,
  canal,
  compacto = false,
}: {
  local: LocalPublico;
  parametros: Parametros;
  canal: 'web' | 'widget';
  compacto?: boolean;
}) {
  const base = canal === 'widget' ? `/r/${local.slug}/widget` : `/r/${local.slug}`;
  const hoy = hoyEn(local.tz);
  const fecha = esFecha(parametros.fecha) ? parametros.fecha! : hoy;
  const personas = Math.min(
    Math.max(Number(parametros.personas) || 2, 1),
    local.personasMaxWeb,
  );
  const horaElegida = esHora(parametros.hora) ? parametros.hora! : null;

  if (!local.webPublica) {
    return (
      <p className="aviso">
        Este local todavía no toma reservas por internet.
        {local.telefonoPublico ? ` Llamalo al ${local.telefonoPublico}.` : ''}
      </p>
    );
  }

  const agenda = await disponibilidad(poolApp(), local, { fecha, personas });
  const porServicio = new Map<string, typeof agenda.horarios>();
  for (const h of agenda.horarios) {
    const lista = porServicio.get(h.franjaNombre);
    if (lista) lista.push(h);
    else porServicio.set(h.franjaNombre, [h]);
  }

  const elegido = agenda.horarios.find((h) => h.hora === horaElegida && h.hayLugar);
  const conParams = (extra: Record<string, string>) =>
    `${base}?${new URLSearchParams({ fecha, personas: String(personas), ...extra })}`;

  return (
    <>
      <section className="tarjeta">
        <p className="paso">
          <span className="numero">1</span> ¿Para cuándo y para cuántos?
        </p>
        {/* GET, no server action: así el estado queda en la URL. */}
        <form method="get" action={base} className="fila">
          <label>
            Día
            <input
              key={fecha}
              type="date"
              name="fecha"
              defaultValue={fecha}
              min={hoy}
              max={sumarDias(hoy, local.diasMaxAnticipacion)}
            />
          </label>
          <label>
            Personas
            <select key={personas} name="personas" defaultValue={String(personas)}>
              {Array.from({ length: local.personasMaxWeb }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? '1 persona' : `${n} personas`}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secundario">
            Ver horarios
          </button>
        </form>
        {personas >= local.personasMaxWeb && local.telefonoPublico && (
          <p className="apagado" style={{ marginBottom: 0 }}>
            ¿Son más de {local.personasMaxWeb}? Escribinos al {local.telefonoPublico} y lo
            armamos a mano.
          </p>
        )}
      </section>

      <section className="tarjeta">
        <p className="paso">
          <span className="numero">2</span> Elegí la hora
        </p>
        <p className="apagado" style={{ marginTop: -8 }}>
          {fechaCorta(instanteLocal(fecha, '12:00', local.tz), local.tz)}
        </p>

        {agenda.horarios.length === 0 ? (
          <p className="vacio">
            {agenda.motivo === 'cerrado'
              ? 'Ese día el local no abre.'
              : 'Para hoy ya no llegamos a tomar reservas. Probá con otro día.'}
          </p>
        ) : (
          [...porServicio].map(([servicio, horarios]) => (
            <div key={servicio}>
              <p className="servicio">{servicio}</p>
              <div className="horarios">
                {horarios.map((h) =>
                  h.hayLugar ? (
                    <Link
                      key={h.hora}
                      href={`${conParams({ hora: h.hora })}#datos`}
                      aria-current={h.hora === horaElegida}
                    >
                      {h.hora}
                    </Link>
                  ) : (
                    <span key={h.hora} title="Sin lugar a esta hora">
                      {h.hora}
                    </span>
                  ),
                )}
              </div>
            </div>
          ))
        )}
        {agenda.motivo === 'sin_lugar' && (
          <p className="apagado">
            Ese día está completo para {personas}. Probá otro día, u otra cantidad.
          </p>
        )}
      </section>

      {elegido && (
        <section className="tarjeta" id="datos">
          <p className="paso">
            <span className="numero">3</span> Tus datos
          </p>
          <p className="resumen">
            <span>
              <b>{fechaCorta(elegido.inicio, local.tz)}</b>
            </span>
            <span>
              a las <b>{horaDe(elegido.inicio, local.tz)}</b>
            </span>
            <span>
              para <b>{personas}</b>
            </span>
          </p>
          <Confirmacion
            slug={local.slug}
            canal={canal}
            fecha={fecha}
            hora={elegido.hora}
            personas={personas}
            compacto={compacto}
          />
        </section>
      )}
    </>
  );
}
