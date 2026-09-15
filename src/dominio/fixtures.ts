import type { DiaSemana, FranjaServicio, Mesa } from './tipos';

/**
 * Salón de prueba. Las posiciones están elegidas a propósito para que las combinaciones
 * queden bien definidas con el radio por defecto (250 cm):
 *
 *   PB:   t2(0) — t2b(200) — t2c(420)     cadena de tres mesas de 2
 *         t4(1000)   aislada, 4 sillas + 2 cabeceras
 *         t6(2000)   aislada, 6 sillas
 *         t3a(3000) — t3b(3200)           par de mesas de 3
 *         t8(4000)   aislada, 8 sillas, no se usa para menos de 5
 *   TERRAZA: x4(0)   misma coordenada que t2, otro salón: nunca se combinan
 */
function mesa(
  id: string,
  salonId: string,
  capacidadBase: number,
  x: number,
  opciones: Partial<Mesa> = {},
): Mesa {
  return {
    id,
    salonId,
    nombre: id,
    capacidadBase,
    cabeceras: 0,
    capacidadMin: 1,
    x,
    y: 0,
    combinable: true,
    activa: true,
    ...opciones,
  };
}

export const SALON: Mesa[] = [
  mesa('t2', 'pb', 2, 0),
  mesa('t2b', 'pb', 2, 200),
  mesa('t2c', 'pb', 2, 420),
  mesa('t4', 'pb', 4, 1000, { cabeceras: 2 }),
  mesa('t6', 'pb', 6, 2000),
  mesa('t3a', 'pb', 3, 3000),
  mesa('t3b', 'pb', 3, 3200),
  mesa('t8', 'pb', 8, 4000, { capacidadMin: 5 }),
  mesa('x4', 'terraza', 4, 0),
];

export const TZ = 'America/Argentina/Buenos_Aires';

export const ALMUERZO: FranjaServicio = {
  id: 'almuerzo',
  nombre: 'Almuerzo',
  dias: [0, 1, 2, 3, 4, 5, 6] as DiaSemana[],
  desde: '12:00',
  hasta: '16:00',
  ultimoIngreso: '15:00',
};

/** Cruza medianoche: cierra a las 02:00 del día siguiente. */
export const CENA: FranjaServicio = {
  id: 'cena',
  nombre: 'Cena',
  dias: [0, 1, 2, 3, 4, 5, 6] as DiaSemana[],
  desde: '20:00',
  hasta: '02:00',
  ultimoIngreso: '01:00',
};

/** Hora local de Buenos Aires (UTC-3) como instante UTC. */
export function local(fechaHora: string): Date {
  return new Date(`${fechaHora}:00-03:00`);
}
