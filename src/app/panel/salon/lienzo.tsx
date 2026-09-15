'use client';

import { useEffect, useRef, useState } from 'react';
import { medidasDeMesa, separacionCm } from '../../../dominio/mesas';
import type { MesaDelPlano } from '../../../servicios/plano';
import { redimensionarSalon, reubicar } from './acciones';

/** Las mesas se acomodan de a 10 cm: alcanza para un salón y evita posiciones absurdas. */
const PASO_CM = 10;
const ANCHO_LIENZO = 880;

interface Props {
  salonId: string;
  anchoCm: number;
  altoCm: number;
  mesas: MesaDelPlano[];
  radioCm: number;
  vetadas: { mesaA: string; mesaB: string }[];
}

/**
 * El salón dibujado a escala, con las mesas arrastrables.
 *
 * El plano tiene el tamaño real del salón y no se reescala solo. Antes se ajustaba para
 * que entraran todas las mesas, y el efecto era que al arrastrar una hacia el borde
 * cambiaba la escala y todo se movía debajo del dedo: la mesa parecía volver para atrás.
 *
 * Las líneas punteadas son las uniones que el motor va a poder armar, y se recalculan
 * mientras arrastrás: acercás dos mesas y aparece la línea, las separás y desaparece.
 */
export default function Lienzo({ salonId, anchoCm, altoCm, mesas, radioCm, vetadas }: Props) {
  const [posiciones, setPosiciones] = useState<Record<string, { x: number; y: number }>>({});
  const [medida, setMedida] = useState({ ancho: anchoCm, alto: altoCm });
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  const destino = useRef<{ x: number; y: number } | null>(null);
  // El guardado va por formularios escondidos en vez de llamar a la acción a mano: así
  // usa el mismo camino que el resto de la página y Next vuelve a renderizar solo. Con
  // la llamada suelta el dato se guardaba pero la tabla mostraba el valor viejo.
  const formMover = useRef<HTMLFormElement>(null);
  const formMedir = useRef<HTMLFormElement>(null);

  const enviar = (form: HTMLFormElement | null, campos: Record<string, string>) => {
    if (!form) return;
    for (const [nombre, valor] of Object.entries(campos)) {
      const campo = form.elements.namedItem(nombre);
      if (campo instanceof HTMLInputElement) campo.value = valor;
    }
    form.requestSubmit();
  };

  // La dependencia son los ids y no el arreglo: el componente recibe uno nuevo en cada
  // render del servidor, y comparar por identidad borraría las posiciones locales de más.
  const claveMesas = mesas.map((m) => m.id).join(',');
  useEffect(() => setPosiciones({}), [claveMesas]);
  useEffect(() => setMedida({ ancho: anchoCm, alto: altoCm }), [anchoCm, altoCm]);

  const pos = (m: MesaDelPlano) => posiciones[m.id] ?? { x: m.x, y: m.y };
  const escala = ANCHO_LIENZO / medida.ancho;
  const px = (cm: number) => cm * escala;

  const vetado = new Set(vetadas.map((v) => [v.mesaA, v.mesaB].sort().join('|')));
  const unibles: [MesaDelPlano, MesaDelPlano][] = [];
  for (let i = 0; i < mesas.length; i++) {
    for (let j = i + 1; j < mesas.length; j++) {
      const a = mesas[i]!;
      const b = mesas[j]!;
      if (!a.combinable || !b.combinable || !a.activa || !b.activa) continue;
      if (vetado.has([a.id, b.id].sort().join('|'))) continue;
      // La misma cuenta que hace el motor: separación entre bordes, no entre centros.
      const separacion = separacionCm({ ...a, ...pos(a) }, { ...b, ...pos(b) });
      if (separacion <= radioCm) unibles.push([a, b]);
    }
  }

  const arrastrarMesa = (mesa: MesaDelPlano, ev: React.PointerEvent) => {
    const caja = contenedor.current?.getBoundingClientRect();
    if (!caja) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    setArrastrando(mesa.id);
    const { ancho, alto } = medidasDeMesa(mesa);

    const mover = (e: PointerEvent) => {
      // Se recorta para que la mesa quede entera adentro del salón: una mesa no puede
      // estar metida en la pared.
      const ajustar = (pixeles: number, largoMesa: number, largoSalon: number) => {
        const cm = Math.round(pixeles / escala / PASO_CM) * PASO_CM;
        return Math.max(largoMesa / 2, Math.min(cm, largoSalon - largoMesa / 2));
      };
      const x = ajustar(e.clientX - caja.left, ancho, medida.ancho);
      const y = ajustar(e.clientY - caja.top, alto, medida.alto);
      destino.current = { x, y };
      setPosiciones((p) => ({ ...p, [mesa.id]: { x, y } }));
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      setArrastrando(null);
      const donde = destino.current;
      destino.current = null;
      if (donde) {
        enviar(formMover.current, {
          mesaId: mesa.id, x: String(donde.x), y: String(donde.y),
        });
      }
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  };

  const agrandar = (ev: React.PointerEvent) => {
    const caja = contenedor.current?.getBoundingClientRect();
    if (!caja) return;
    ev.preventDefault();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    let ultima = medida;

    const mover = (e: PointerEvent) => {
      // El ancho manda la escala, así que se calcula con la escala vieja para que el
      // plano no se escape mientras se tira del tirador.
      const ancho = Math.min(10000, Math.max(200,
        Math.round((e.clientX - caja.left) / escala / 50) * 50));
      const alto = Math.min(10000, Math.max(200,
        Math.round((e.clientY - caja.top) / escala / 50) * 50));
      ultima = { ancho, alto };
      setMedida(ultima);
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      enviar(formMedir.current, {
        anchoCm: String(ultima.ancho), altoCm: String(ultima.alto),
      });
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  };

  return (
    <>
      <div
        ref={contenedor}
        className="lienzo"
        style={{ width: ANCHO_LIENZO, height: Math.max(120, px(medida.alto)) }}
        role="application"
        aria-label="Plano del salón"
      >
        <svg className="uniones" width="100%" height="100%">
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
          const { ancho, alto } = medidasDeMesa(m);
          return (
            <button
              key={m.id}
              type="button"
              className={[
                'ficha', `forma-${m.forma}`,
                m.activa ? '' : 'inactiva',
                m.combinable ? '' : 'fija',
                arrastrando === m.id ? 'moviendo' : '',
              ].filter(Boolean).join(' ')}
              style={{
                left: px(p.x), top: px(p.y),
                width: Math.max(26, px(ancho)), height: Math.max(22, px(alto)),
              }}
              onPointerDown={(ev) => arrastrarMesa(m, ev)}
              title={[
                m.nombre,
                `${m.capacidadBase}${m.cabeceras ? `–${m.capacidadBase + m.cabeceras}` : ''} lugares`,
                m.combinable ? 'se puede unir' : 'fija',
                `${p.x} × ${p.y} cm`,
              ].join(' · ')}
            >
              <span>{m.nombre}</span>
            </button>
          );
        })}

        <button
          type="button"
          className="tirador"
          onPointerDown={agrandar}
          title="Arrastrá para agrandar o achicar el salón"
          aria-label="Cambiar el tamaño del salón"
        />
      </div>

      <form ref={formMover} action={reubicar} hidden>
        <input type="hidden" name="mesaId" defaultValue="" />
        <input type="hidden" name="x" defaultValue="0" />
        <input type="hidden" name="y" defaultValue="0" />
      </form>
      <form ref={formMedir} action={redimensionarSalon} hidden>
        <input type="hidden" name="salonId" value={salonId} readOnly />
        <input type="hidden" name="anchoCm" defaultValue={String(anchoCm)} />
        <input type="hidden" name="altoCm" defaultValue={String(altoCm)} />
      </form>

      <p className="apagado">
        Salón de <strong>{(medida.ancho / 100).toFixed(1)} × {(medida.alto / 100).toFixed(1)} m</strong>,
        dibujado a escala. Arrastrá las mesas para acomodarlas y el tirador de la esquina de
        abajo a la derecha para agrandar el salón. Las líneas punteadas son las uniones que el
        sistema va a poder armar: aparecen cuando dos mesas quedan a menos de {radioCm} cm.
        Las mesas con borde punteado son fijas: no se unen con nadie.
      </p>
    </>
  );
}
