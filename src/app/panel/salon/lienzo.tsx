'use client';

import { useEffect, useRef, useState } from 'react';
import type { MesaDelPlano } from '../../../servicios/plano';
import { reubicar } from './acciones';

/** Las mesas se acomodan de a 10 cm: alcanza para un salón y evita posiciones absurdas. */
const PASO_CM = 10;
const ANCHO_LIENZO = 860;
/** Aire alrededor: una mesa en el 0,0 queda dibujada adentro y no cortada por el borde. */
const MARGEN_CM = 90;

interface Props {
  mesas: MesaDelPlano[];
  radioCm: number;
  vetadas: { mesaA: string; mesaB: string }[];
}

/**
 * El salón dibujado, con las mesas arrastrables.
 *
 * Las líneas entre mesas son las uniones que el motor va a poder armar, y se recalculan
 * mientras arrastrás. Es la única forma de entender el criterio de cercanía sin tenerlo
 * que imaginar: acercás dos mesas y aparece la línea, las separás y desaparece.
 */
export default function Lienzo({ mesas, radioCm, vetadas }: Props) {
  const [posiciones, setPosiciones] = useState<Record<string, { x: number; y: number }>>({});
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  const destino = useRef<{ x: number; y: number } | null>(null);

  // Si el servidor devuelve otras posiciones (otro salón, o una edición), se descartan
  // las locales para no mostrar una mesa donde ya no está.
  useEffect(() => setPosiciones({}), [mesas]);

  const pos = (m: MesaDelPlano) => posiciones[m.id] ?? { x: m.x, y: m.y };
  const maxX = Math.max(600, ...mesas.map((m) => pos(m).x)) + MARGEN_CM * 2;
  const maxY = Math.max(400, ...mesas.map((m) => pos(m).y)) + MARGEN_CM * 2;
  const escala = ANCHO_LIENZO / maxX;
  const alto = Math.max(240, Math.min(620, maxY * escala));
  const px = (cm: number) => (cm + MARGEN_CM) * escala;

  const vetado = new Set(vetadas.map((v) => [v.mesaA, v.mesaB].sort().join('|')));
  const unibles: [MesaDelPlano, MesaDelPlano][] = [];
  for (let i = 0; i < mesas.length; i++) {
    for (let j = i + 1; j < mesas.length; j++) {
      const a = mesas[i]!;
      const b = mesas[j]!;
      if (!a.combinable || !b.combinable || !a.activa || !b.activa) continue;
      if (vetado.has([a.id, b.id].sort().join('|'))) continue;
      const pa = pos(a);
      const pb = pos(b);
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) <= radioCm) unibles.push([a, b]);
    }
  }

  const alMover = (mesaId: string, ev: React.PointerEvent) => {
    const caja = contenedor.current?.getBoundingClientRect();
    if (!caja) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    setArrastrando(mesaId);

    const mover = (e: PointerEvent) => {
      const cm = (pixeles: number) =>
        Math.max(0, Math.round((pixeles / escala - MARGEN_CM) / PASO_CM) * PASO_CM);
      const x = cm(e.clientX - caja.left);
      const y = cm(e.clientY - caja.top);
      // El destino se guarda acá y no se lee del estado al soltar: un actualizador de
      // estado tiene que ser puro, y meter el guardado adentro hace que React lo llame
      // dos veces en desarrollo o lo postergue.
      destino.current = { x, y };
      setPosiciones((p) => ({ ...p, [mesaId]: { x, y } }));
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      setArrastrando(null);
      if (destino.current) void reubicar(mesaId, destino.current.x, destino.current.y);
      destino.current = null;
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  };

  if (mesas.length === 0) {
    return <p className="vacio">Este salón todavía no tiene mesas. Agregá la primera abajo.</p>;
  }

  return (
    <>
      <div
        ref={contenedor}
        className="lienzo"
        style={{ height: alto }}
        role="application"
        aria-label="Plano del salón"
      >
        <svg className="uniones" width="100%" height={alto}>
          {unibles.map(([a, b]) => (
            <line
              key={`${a.id}-${b.id}`}
              x1={px(pos(a).x)} y1={px(pos(a).y)}
              x2={px(pos(b).x)} y2={px(pos(b).y)}
            />
          ))}
        </svg>

        {mesas.map((m) => {
          const p = pos(m);
          const lado = Math.round(Math.min(74, 30 + (m.capacidadBase + m.cabeceras) * 5));
          return (
            <button
              key={m.id}
              type="button"
              className={`ficha ${m.activa ? '' : 'inactiva'} ${arrastrando === m.id ? 'moviendo' : ''}`}
              style={{
                left: px(p.x), top: px(p.y),
                width: lado, height: lado,
                borderRadius: m.combinable ? 8 : '50%',
              }}
              onPointerDown={(ev) => alMover(m.id, ev)}
              title={`${m.nombre} · ${m.capacidadBase}${m.cabeceras ? `–${m.capacidadBase + m.cabeceras}` : ''} lugares · ${p.x}×${p.y} cm`}
            >
              <span>{m.nombre}</span>
              <small>{m.capacidadBase}{m.cabeceras > 0 && `+${m.cabeceras}`}</small>
            </button>
          );
        })}
      </div>

      <p className="apagado">
        Arrastrá las mesas para acomodarlas. Las líneas son las uniones que el sistema va a
        poder armar: aparecen cuando dos mesas quedan a menos de {radioCm} cm.
        Las redondas son mesas fijas, que no se mueven ni se unen con nadie.
      </p>
    </>
  );
}
