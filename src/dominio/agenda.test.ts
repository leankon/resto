import { describe, expect, it } from 'vitest';
import { horariosDelDia, horasDeApertura, instanteDeServicio } from './agenda';
import { ALMUERZO, CENA, TZ, local } from './fixtures';
import type { DiaSemana } from './tipos';
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

describe('horasDeApertura', () => {
  it('va de cuarto en cuarto de hora, sin horas sueltas en el medio', () => {
    // El plano se mira de a saltos parejos: poder caer en las 23:01 no le sirve a nadie
    // y hace que dos personas miren momentos distintos creyendo que miran el mismo.
    for (const hora of horasDeApertura('2026-09-15', config)) {
      expect(['00', '15', '30', '45']).toContain(hora.slice(3));
    }
  });

  it('llega hasta el cierre, aunque sea de madrugada', () => {
    const horas = horasDeApertura('2026-09-15', config);

    expect(horas).toContain('12:00');   // abre el almuerzo
    expect(horas).toContain('16:00');   // cierra el almuerzo
    expect(horas).toContain('20:00');   // abre la cena
    expect(horas).toContain('23:30');
    // A la 01:00 todavía hay mesas ocupadas y el encargado tiene que poder verlas.
    expect(horas).toContain('01:00');
    expect(horas).toContain('02:00');
  });

  it('la madrugada va al final, que es cuando pasa', () => {
    // Ordenadas por etiqueta, la 01:00 saldría antes que el almuerzo.
    const horas = horasDeApertura('2026-09-15', config);
    expect(horas.at(-1)).toBe('02:00');
    expect(horas[0]).toBe('12:00');
  });

  it('la apertura entra aunque no caiga en el paso', () => {
    const abreQuebrado = {
      ...config,
      franjas: [{ ...CENA, desde: '19:35', dias: [2] as DiaSemana[] }],
    };
    const horas = horasDeApertura('2026-09-15', abreQuebrado);

    expect(horas[0]).toBe('19:35');
    expect(horas[1]).toBe('19:45');
  });

  it('un día sin servicio no tiene horas que mirar', () => {
    const soloSabados = { ...config, franjas: [{ ...CENA, dias: [6 as const] }] };
    expect(horasDeApertura('2026-09-15', soloSabados)).toEqual([]);
  });

  it('no repite horas cuando dos franjas se tocan', () => {
    const pegadas = {
      ...config,
      franjas: [ALMUERZO, { ...ALMUERZO, id: 'merienda', desde: '16:00', hasta: '20:00' }],
    };
    const horas = horasDeApertura('2026-09-15', pegadas);
    expect(new Set(horas).size).toBe(horas.length);
  });
});

describe('instanteDeServicio', () => {
  const CORTE = 120; // el local cierra a las 02:00

  it('la madrugada del sábado es, en el reloj, la del domingo', () => {
    expect(instanteDeServicio('2026-09-15', '01:00', TZ, CORTE).toISOString()).toBe(
      local('2026-09-16T01:00').toISOString(),
    );
  });

  it('la cena de las 21:00 es la de ese mismo día', () => {
    expect(instanteDeServicio('2026-09-15', '21:00', TZ, CORTE).toISOString()).toBe(
      local('2026-09-15T21:00').toISOString(),
    );
  });

  it('la hora de cierre todavía es la noche anterior', () => {
    // A las 02:00 se están yendo los últimos de la noche del 15, no llegando los del 16.
    expect(instanteDeServicio('2026-09-15', '02:00', TZ, CORTE).toISOString()).toBe(
      local('2026-09-16T02:00').toISOString(),
    );
  });

  it('sin corte, la medianoche es la de ese día y no la del siguiente', () => {
    expect(instanteDeServicio('2026-09-15', '00:00', TZ, 0).toISOString()).toBe(
      local('2026-09-15T00:00').toISOString(),
    );
  });
});
