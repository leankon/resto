import type { Centimetros, Mesa } from './tipos';

/**
 * Cuánto mide la mesa de verdad, según su forma y cuánta gente sienta.
 *
 * Vive en el dominio y no en la pantalla porque no es solo para dibujar: de acá sale la
 * distancia entre dos mesas, y de ahí si se pueden unir.
 */
export function medidasDeMesa(mesa: Pick<Mesa, 'forma' | 'capacidadBase'>): {
  ancho: Centimetros;
  alto: Centimetros;
} {
  const n = Math.max(1, mesa.capacidadBase);
  switch (mesa.forma) {
    case 'redonda': {
      const diametro = Math.min(220, 80 + (n - 2) * 14);
      return { ancho: diametro, alto: diametro };
    }
    case 'cuadrada': {
      const lado = Math.min(200, 75 + (n - 2) * 12);
      return { ancho: lado, alto: lado };
    }
    case 'barra':
      return { ancho: Math.min(600, 55 * n), alto: 45 };
    default:
      // Rectangular: dos comensales por lado largo.
      return { ancho: Math.min(360, 70 * Math.ceil(n / 2)), alto: 80 };
  }
}

type MesaUbicada = Pick<Mesa, 'forma' | 'capacidadBase' | 'x' | 'y'>;

/**
 * Cuánto hay que arrimar dos mesas para que se toquen, en centímetros. Cero si ya están
 * pegadas o superpuestas.
 *
 * Es la separación entre los BORDES, no entre los centros. Medir de centro a centro
 * parece lo mismo y no lo es: dos mesas de ocho pegadas una contra la otra tienen los
 * centros a casi tres metros, así que con ese criterio el sistema nunca las unía por
 * más juntas que estuvieran, mientras que dos mesas de dos a la misma distancia real sí.
 * El resultado era que las mesas grandes no se combinaban nunca.
 */
export function separacionCm(a: MesaUbicada, b: MesaUbicada): Centimetros {
  const ma = medidasDeMesa(a);
  const mb = medidasDeMesa(b);
  const dx = Math.max(0, Math.abs(a.x - b.x) - (ma.ancho + mb.ancho) / 2);
  const dy = Math.max(0, Math.abs(a.y - b.y) - (ma.alto + mb.alto) / 2);
  return Math.hypot(dx, dy);
}
