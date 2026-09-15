'use client';

import { useActionState, useState } from 'react';
import { medidasDeMesa } from '../../dominio/mesas';
import type { MesaEnPlano, SalonEnPlano } from '../../servicios/panel';
import { hora as formatearHora } from '../../web/formato';
import { moverDesdeElPlano } from './acciones';

const ANCHO_LIENZO = 880;

/** Cómo se ve cada mesa según quién la tiene en ese momento. */
function estadoDeMesa(mesa: MesaEnPlano): 'libre' | 'esperando' | 'sentada' | 'aviso' {
  if (!mesa.ocupadaPor) return 'libre';
  if (mesa.ocupadaPor.estado === 'sentada') return 'sentada';
  if (mesa.ocupadaPor.estado === 'en_riesgo') return 'aviso';
  return 'esperando';
}

/**
 * El salón dibujado a escala, tal como está a una hora dada, con la reasignación a mano.
 *
 * El motor asigna solo, pero quien está en el salón ve cosas que el sistema no: que la
 * mesa de la ventana tiene corriente de aire, que el cumpleaños necesita estar lejos de
 * la cocina. Tocar una mesa ocupada y después una libre mueve la reserva entera, y queda
 * fijada: el re-optimizador automático no vuelve a pisarla (D2).
 */
export default function Plano({
  salon,
  tz,
  hora,
}: {
  salon: SalonEnPlano;
  tz: string;
  hora: string;
}) {
  const [error, mover, moviendo] = useActionState<string | null, FormData>(
    moverDesdeElPlano,
    null,
  );
  const [elegida, setElegida] = useState<string | null>(null);
  const [destinos, setDestinos] = useState<string[]>([]);

  const mesaElegida = salon.mesas.find((m) => m.id === elegida);
  const reserva = mesaElegida?.ocupadaPor ?? null;

  // El turno entero de la reserva elegida, no el instante que se está mirando. Una mesa
  // libre a las 21:00 puede estar tomada a las 21:15: ofrecerla es mandar al staff a un
  // rechazo de la base con el cliente esperando.
  const periodo = mesaElegida?.ocupaciones.find((o) => o.reservaId === reserva?.reservaId);
  const puedeRecibir = (mesa: MesaEnPlano) =>
    !!periodo &&
    mesa.ocupaciones.every(
      (o) =>
        o.reservaId === reserva?.reservaId ||
        new Date(o.hasta) <= new Date(periodo.desde) ||
        new Date(o.desde) >= new Date(periodo.hasta),
    );
  const escala = ANCHO_LIENZO / salon.anchoCm;
  const px = (cm: number) => cm * escala;

  const soltar = () => {
    setElegida(null);
    setDestinos([]);
  };

  const tocar = (mesa: MesaEnPlano) => {
    if (mesa.ocupadaPor) {
      // Tocar otra mesa ocupada cambia de reserva en vez de no hacer nada: es lo que
      // espera quien está mirando el salón y se equivocó de mesa.
      if (mesa.id === elegida) soltar();
      else {
        setElegida(mesa.id);
        setDestinos([]);
      }
      return;
    }
    if (!elegida || !puedeRecibir(mesa)) return;
    setDestinos((actual) =>
      actual.includes(mesa.id) ? actual.filter((id) => id !== mesa.id) : [...actual, mesa.id],
    );
  };

  const libresQueSirven = salon.mesas.filter(
    (m) => !m.ocupadaPor && puedeRecibir(m),
  ).length;
  const nombresDestino = destinos
    .map((id) => salon.mesas.find((m) => m.id === id)?.nombre)
    .filter(Boolean)
    .join(' + ');

  return (
    <>
      <div
        className="lienzo plano-vivo"
        style={{ width: ANCHO_LIENZO, height: px(salon.altoCm) }}
      >
        {salon.mesas.map((mesa) => {
          const { ancho, alto } = medidasDeMesa(mesa);
          const estado = estadoDeMesa(mesa);
          const esDestino = destinos.includes(mesa.id);
          const clases = [
            'ficha',
            `forma-${mesa.forma}`,
            estado,
            mesa.id === elegida ? 'elegida' : '',
            esDestino ? 'destino' : '',
            elegida && estado === 'libre' && !esDestino && puedeRecibir(mesa) ? 'posible' : '',
            elegida && estado === 'libre' && !puedeRecibir(mesa) ? 'nolesirve' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <button
              key={mesa.id}
              type="button"
              className={clases}
              style={{
                left: px(mesa.x),
                top: px(mesa.y),
                width: px(ancho),
                height: px(alto),
              }}
              onClick={() => tocar(mesa)}
              title={
                mesa.ocupadaPor
                  ? `${mesa.ocupadaPor.cliente ?? 'Sin reserva'} · ${mesa.ocupadaPor.personas} personas · ${formatearHora(new Date(mesa.ocupadaPor.inicio), tz)}`
                  : elegida && !puedeRecibir(mesa)
                    ? `Mesa ${mesa.nombre}: está libre a las ${hora}, pero la toman antes de que termine este turno`
                    : `Mesa ${mesa.nombre}, libre a las ${hora}`
              }
            >
              <span>{mesa.nombre}</span>
              {mesa.ocupadaPor && <em>{mesa.ocupadaPor.personas}</em>}
            </button>
          );
        })}
      </div>

      <div className="referencias">
        <span className="ref libre">Libre</span>
        <span className="ref esperando">Reservada</span>
        <span className="ref sentada">En mesa</span>
      </div>

      {error && <p className="aviso">{error}</p>}

      {reserva && (
        <form action={mover} className="mover">
          <input type="hidden" name="reservaId" value={reserva.reservaId} />
          {destinos.map((id) => (
            <input key={id} type="hidden" name="mesaId" value={id} />
          ))}
          <div style={{ flex: '1 1 260px' }}>
            <strong>{reserva.cliente ?? 'Sin reserva'}</strong> · {reserva.personas} personas ·{' '}
            {formatearHora(new Date(reserva.inicio), tz)}
            <div className="apagado">
              {reserva.conMesas.length > 0
                ? `Ocupa las mesas ${[mesaElegida!.nombre, ...reserva.conMesas].join(' + ')}. Se mueve entera.`
                : `Mesa ${mesaElegida!.nombre}.`}{' '}
              {destinos.length > 0
                ? `Va a pasar a ${nombresDestino}.`
                : libresQueSirven === 0
                  ? 'No hay ninguna otra mesa libre durante todo este turno.'
                  : libresQueSirven === 1
                    ? 'Tocá la mesa marcada para moverla: es la única libre todo el turno.'
                    : `Tocá una de las ${libresQueSirven} mesas marcadas para moverla.`}
            </div>
          </div>
          <div className="acciones" style={{ flex: '0 0 auto' }}>
            <button type="submit" className="chico" disabled={destinos.length === 0 || moviendo}>
              {moviendo ? 'Moviendo…' : 'Mover'}
            </button>
            <button type="button" className="secundario chico" onClick={soltar}>
              Dejar como está
            </button>
          </div>
        </form>
      )}
    </>
  );
}
