'use client';

import { useEffect } from 'react';

/**
 * Le avisa a la página que contiene el widget cuánto mide, para que crezca el iframe.
 *
 * Un iframe no se ajusta solo al contenido: sin esto, elegir un horario abre el
 * formulario de datos y queda con scroll adentro de un recuadro de 400 píxeles.
 *
 * Solo viaja un número. Aunque la página de al lado sea de un tercero, no hay nada
 * que filtrar.
 */
export default function AltoAlPadre() {
  useEffect(() => {
    if (window.parent === window) return;

    const avisar = () => {
      const alto = Math.ceil(document.documentElement.scrollHeight);
      window.parent.postMessage({ resto: 'alto', alto }, '*');
    };

    avisar();
    const observador = new ResizeObserver(avisar);
    observador.observe(document.body);
    return () => observador.disconnect();
  }, []);

  return null;
}
