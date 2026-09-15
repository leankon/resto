import { describe, expect, it } from 'vitest';
import { horariosDelDia } from './agenda';
import { ALMUERZO, CENA, TZ, local } from './fixtures';
import { reglasSembradas, type ConfigTurnos } from './turnos';

const config: ConfigTurnos = {
  tz: TZ,
  franjas: [ALMUERZO, CENA],
  reglas: reglasSembradas('almuerzo', 'cena'),
  duracionPorDefecto: 120,
  bufferPorDefecto: 15,
};

describe('horariosDelDia', () => {
  it('ofrece desde la apertura hasta el último ingreso, cada 15 minutos', () => {
    const almuerzo = horariosDelDia('2026-09-15', 2, config).filter(
      (h) => h.franjaId === 'almuerzo',
    );

    expect(almuerzo[0]!.hora).toBe('12:00');
    expect(almuerzo.at(-1)!.hora).toBe('15:00');
    // 12:00 a 15:00 inclusive, de a 15 minutos.
    expect(almuerzo).toHaveLength(13);
  });

  it('la cena que cruza medianoche sigue siendo del mismo día de servicio', () => {
    const cena = horariosDelDia('2026-09-15', 2, config).filter((h) => h.franjaId === 'cena');

    expect(cena[0]!.hora).toBe('20:00');
    expect(cena.at(-1)!.hora).toBe('01:00');
    // El instante del último es del día siguiente aunque el servicio sea el del 15.
    expect(cena.at(-1)!.inicio.toISOString()).toBe(local('2026-09-16T01:00').toISOString());
  });

  it('no ofrece nada un día cerrado por excepción', () => {
    const conFeriado = {
      ...config,
      excepciones: [{ fecha: '2026-09-15', cerrado: true, motivo: 'Feriado' }],
    };
    expect(horariosDelDia('2026-09-15', 2, conFeriado)).toEqual([]);
  });

  it('un horario especial recorta la oferta de ese día', () => {
    const conHorarioEspecial = {
      ...config,
      excepciones: [{ fecha: '2026-09-15', cerrado: false, desde: '13:00', hasta: '14:00' }],
    };
    const horas = horariosDelDia('2026-09-15', 2, conHorarioEspecial).map((h) => h.hora);

    expect(horas[0]).toBe('13:00');
    expect(horas.at(-1)).toBe('13:45');
  });

  it('respeta los días de la semana de cada franja', () => {
    const soloSabados = {
      ...config,
      franjas: [{ ...CENA, dias: [6 as const] }],
    };
    // 2026-09-15 es martes.
    expect(horariosDelDia('2026-09-15', 2, soloSabados)).toEqual([]);
    expect(horariosDelDia('2026-09-19', 2, soloSabados).length).toBeGreaterThan(0);
  });

  it('cada horario trae la duración del turno que le corresponde al grupo', () => {
    const pareja = horariosDelDia('2026-09-15', 2, config).find((h) => h.hora === '21:00');
    const grupo = horariosDelDia('2026-09-15', 10, config).find((h) => h.hora === '21:00');

    expect(pareja!.duracionMin).toBe(90);
    expect(grupo!.duracionMin).toBe(150);
  });

  it('arranca en el primer múltiplo del paso, no antes de abrir', () => {
    const abreYQuebrado = {
      ...config,
      franjas: [{ ...ALMUERZO, desde: '12:10', ultimoIngreso: '12:40' }],
    };
    expect(horariosDelDia('2026-09-15', 2, abreYQuebrado).map((h) => h.hora)).toEqual([
      '12:15',
      '12:30',
    ]);
  });

  it('no repite un instante cubierto por dos franjas', () => {
    const solapadas = {
      ...config,
      franjas: [ALMUERZO, { ...ALMUERZO, id: 'brunch', nombre: 'Brunch' }],
    };
    const instantes = horariosDelDia('2026-09-15', 2, solapadas).map((h) => h.inicio.getTime());
    expect(new Set(instantes).size).toBe(instantes.length);
  });
});
