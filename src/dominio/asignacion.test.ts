import { describe, expect, it } from 'vitest';
import { asignar, buscarAlternativas, type Pedido } from './asignacion.js';
import { derivarCandidatos } from './combinaciones.js';
import { SALON, local } from './fixtures.js';
import { CONFIG_POR_DEFECTO, type Ocupacion } from './tipos.js';

const candidatos = derivarCandidatos(SALON, CONFIG_POR_DEFECTO);

const pedido = (personas: number, extra: Partial<Pedido> = {}): Pedido => ({
  inicio: local('2026-09-15T21:00'),
  personas,
  duracionMin: 105,
  bufferMin: 15,
  ...extra,
});

/** Ocupa mesas en el mismo horario del pedido base. */
function ocupar(...mesaIds: string[]): Ocupacion[] {
  return mesaIds.map((mesaId, i) => ({
    mesaId,
    reservaId: `r${i}`,
    periodo: { desde: local('2026-09-15T20:30'), hasta: local('2026-09-15T22:30') },
  }));
}

const elegir = (p: Pedido, ocupaciones: Ocupacion[] = []) =>
  asignar(candidatos, ocupaciones, p, CONFIG_POR_DEFECTO);

describe('asignar', () => {
  it('sienta a una pareja en la mesa chica, no en la grande que está libre', () => {
    const resultado = elegir(pedido(2));
    expect(resultado.tipo).toBe('asignada');
    expect(resultado.log.elegido).toBe('t2');
  });

  it('protege la única mesa de 8 del salón', () => {
    // Con t2, t2b y t2c ocupadas, la pareja prefiere una mesa de 3 antes que la de 8.
    const resultado = elegir(pedido(2), ocupar('t2', 't2b', 't2c'));
    expect(resultado.log.elegido).toBe('t3a');
  });

  it('resuelve un grupo de 6 en el orden esperado a medida que se llena el salón', () => {
    // Es el orden que promete el doc 03, y lo produce el puntaje, no una lista de reglas.
    expect(elegir(pedido(6)).log.elegido).toBe('t6');
    expect(elegir(pedido(6), ocupar('t6')).log.elegido).toBe('t4'); // 4 + dos cabeceras
    expect(elegir(pedido(6), ocupar('t6', 't4')).log.elegido).toBe('t3a+t3b');
    // Antes de quemar la única mesa de 8 con un grupo de 6, arma la fila de mesas de 2.
    expect(elegir(pedido(6), ocupar('t6', 't4', 't3a')).log.elegido).toBe('t2+t2b+t2c');
    // Recién cuando no queda nada más, se usa la de 8.
    expect(elegir(pedido(6), ocupar('t6', 't4', 't3a', 't2b')).log.elegido).toBe('t8');
  });

  it('usa la mesa grande sin penalidad cuando el grupo la llena', () => {
    // Ocupar la mesa de 8 con ocho personas no tiene nada de malo: el problema es
    // ocuparla con seis. El recargo por escasez pesa sobre las sillas que sobran.
    const ocho = elegir(pedido(8));
    expect(ocho.log.elegido).toBe('t8');
    expect(ocho.log.evaluados[0]!.detalle).toMatchObject({ desperdicio: 0, escasez: 0 });
  });

  it('informa cuántas sillas de punta hay que agregar', () => {
    const resultado = elegir(pedido(6), ocupar('t6'));
    expect(resultado).toMatchObject({ tipo: 'asignada', cabecerasUsadas: 2 });
    expect(elegir(pedido(6)).tipo === 'asignada' && elegir(pedido(6))).toMatchObject({
      cabecerasUsadas: 0,
    });
  });

  it('prefiere la combinación que hace mover menos las mesas', () => {
    // t2+t2b están a 200 cm; t2b+t2c a 220. Mismo desperdicio, gana la más junta.
    const resultado = elegir(pedido(4), ocupar('t4', 'x4'));
    expect(resultado.log.elegido).toBe('t2+t2b');
  });

  it('una sola mesa le gana a dos mesas unidas', () => {
    expect(elegir(pedido(4)).log.elegido).toBe('t4');
  });

  it('respeta el salón que pidió el cliente', () => {
    const resultado = elegir(pedido(4, { salonPreferido: 'terraza' }));
    expect(resultado.log.elegido).toBe('x4');
  });

  it('no asigna una mesa ocupada y deja dicho por qué', () => {
    const resultado = elegir(pedido(6), ocupar('t6'));
    expect(resultado.log.descartados).toContainEqual({
      clave: 't6',
      etiqueta: 't6',
      motivo: 'ocupada: t6',
    });
  });

  it('respeta el buffer de limpieza de la reserva anterior', () => {
    // La reserva previa termina 21:00, pero con 15 min de buffer ocupa hasta 21:15.
    const previa: Ocupacion[] = [
      {
        mesaId: 't6',
        reservaId: 'previa',
        periodo: { desde: local('2026-09-15T19:15'), hasta: local('2026-09-15T21:15') },
      },
    ];
    expect(elegir(pedido(6), previa).log.elegido).not.toBe('t6');

    // A las 21:15 en punto ya se puede: los periodos son semiabiertos.
    const justo = pedido(6, { inicio: local('2026-09-15T21:15') });
    expect(asignar(candidatos, previa, justo, CONFIG_POR_DEFECTO).log.elegido).toBe('t6');
  });

  it('un walk-in bloquea la mesa igual que una reserva (D6)', () => {
    const walkIn: Ocupacion[] = [
      {
        mesaId: 't6',
        reservaId: 'walk-in-1',
        periodo: { desde: local('2026-09-15T20:50'), hasta: local('2026-09-15T22:50') },
      },
    ];
    expect(elegir(pedido(6), walkIn).log.elegido).not.toBe('t6');
  });

  it('antes que decir que no hay lugar, usa una mesa más grande de lo aconsejable', () => {
    // t8 no se ofrece para menos de 5 personas... salvo que sea lo único que queda.
    const soloLaGrande = derivarCandidatos(
      SALON.filter((m) => m.id === 't8'),
      CONFIG_POR_DEFECTO,
    );
    const resultado = asignar(soloLaGrande, [], pedido(2), CONFIG_POR_DEFECTO);
    expect(resultado.tipo).toBe('asignada');
    expect(resultado.log.capacidadMinRelajada).toBe(true);
  });

  it('dice que no hay lugar cuando de verdad no lo hay', () => {
    const todasOcupadas = ocupar(...SALON.map((m) => m.id));
    const resultado = elegir(pedido(4), todasOcupadas);
    expect(resultado.tipo).toBe('sin_lugar');
    expect(resultado.log.elegido).toBeNull();
    expect(resultado.log.descartados.length).toBeGreaterThan(0);
  });

  it('no inventa lugar para un grupo que no entra en ninguna combinación', () => {
    const resultado = elegir(pedido(30));
    expect(resultado.tipo).toBe('sin_lugar');
    expect(resultado.log.descartados.every((d) => d.motivo === 'no entra el grupo')).toBe(true);
  });

  it('es determinista: el mismo pedido da siempre la misma mesa', () => {
    const uno = elegir(pedido(4), ocupar('t4'));
    const dos = elegir(pedido(4), ocupar('t4'));
    expect(uno.log.elegido).toBe(dos.log.elegido);
  });

  it('deja el rastro completo de la decisión para poder auditarla', () => {
    const { log } = elegir(pedido(6), ocupar('t6'));
    const ganador = log.evaluados[0]!;

    expect(log.versionAlgoritmo).toBe('1.0.0');
    expect(log.entrada).toMatchObject({ personas: 6, duracionMin: 105, bufferMin: 15 });
    expect(ganador.clave).toBe('t4');
    expect(ganador.detalle).toMatchObject({ cabeceras: 12, desperdicio: 0 });
    // Los puntajes vienen ordenados de mejor a peor.
    const puntajes = log.evaluados.map((e) => e.puntaje);
    expect([...puntajes].sort((a, b) => a - b)).toEqual(puntajes);
  });
});

describe('buscarAlternativas', () => {
  it('ofrece horarios cercanos antes de mandar al cliente a la lista de espera', () => {
    const ocupaciones: Ocupacion[] = SALON.map((m, i) => ({
      mesaId: m.id,
      reservaId: `r${i}`,
      periodo: { desde: local('2026-09-15T20:00'), hasta: local('2026-09-15T21:30') },
    }));

    expect(elegir(pedido(4), ocupaciones).tipo).toBe('sin_lugar');

    const alternativas = buscarAlternativas(
      candidatos,
      ocupaciones,
      pedido(4),
      CONFIG_POR_DEFECTO,
    );
    expect(alternativas.length).toBeGreaterThan(0);
    // La más cercana al horario pedido va primero.
    expect(alternativas[0]!.desplazamientoMin).toBe(30);
  });
});
