import { describe, expect, it } from 'vitest';
import { ALMUERZO, CENA, TZ, local } from './fixtures';
import {
  corteDelDia,
  diaDeServicio,
  reglasSembradas,
  resolverTurno,
  type ConfigTurnos,
} from './turnos';

const config: ConfigTurnos = {
  tz: TZ,
  franjas: [ALMUERZO, CENA],
  reglas: reglasSembradas('almuerzo', 'cena'),
  duracionPorDefecto: 120,
  bufferPorDefecto: 15,
};

describe('resolverTurno', () => {
  it('el almuerzo rota más rápido que la cena para el mismo grupo (D1)', () => {
    const almuerzo = resolverTurno(local('2026-09-15T13:00'), 4, config);
    const cena = resolverTurno(local('2026-09-15T21:00'), 4, config);

    expect(almuerzo).toMatchObject({ tipo: 'ok', franjaId: 'almuerzo', duracionMin: 90 });
    expect(cena).toMatchObject({ tipo: 'ok', franjaId: 'cena', duracionMin: 105 });
  });

  it('un grupo grande ocupa la mesa más tiempo que una pareja', () => {
    const pareja = resolverTurno(local('2026-09-15T21:00'), 2, config);
    const grupo = resolverTurno(local('2026-09-15T21:00'), 10, config);

    expect(pareja).toMatchObject({ tipo: 'ok', duracionMin: 90, bufferMin: 0 });
    expect(grupo).toMatchObject({ tipo: 'ok', duracionMin: 150, bufferMin: 0 });
  });

  it('la 00:30 del miércoles todavía es la cena del martes', () => {
    // Sin esto, todo bar nocturno queda "fuera de servicio" después de las 12.
    const resultado = resolverTurno(local('2026-09-16T00:30'), 2, config);
    expect(resultado).toMatchObject({ tipo: 'ok', franjaId: 'cena' });
  });

  it('rechaza un horario en el que el local está cerrado', () => {
    expect(resolverTurno(local('2026-09-15T18:00'), 2, config)).toEqual({
      tipo: 'fuera_de_servicio',
    });
  });

  it('rechaza un ingreso posterior al último permitido, en ambos tipos de franja', () => {
    expect(resolverTurno(local('2026-09-15T15:30'), 2, config)).toMatchObject({
      tipo: 'despues_del_ultimo_ingreso',
      franjaNombre: 'Almuerzo',
    });
    expect(resolverTurno(local('2026-09-16T01:30'), 2, config)).toMatchObject({
      tipo: 'despues_del_ultimo_ingreso',
      franjaNombre: 'Cena',
    });
    // Las 23:00 siguen estando dentro del horario de ingreso de la cena.
    expect(resolverTurno(local('2026-09-15T23:00'), 2, config)).toMatchObject({ tipo: 'ok' });
  });

  it('cae al comodín cuando el local creó una franja sin reglas propias', () => {
    const brunch = { ...ALMUERZO, id: 'brunch', nombre: 'Brunch' };
    const resultado = resolverTurno(local('2026-09-15T13:00'), 4, {
      ...config,
      franjas: [brunch],
    });
    expect(resultado).toMatchObject({ tipo: 'ok', origenRegla: 'comodin', duracionMin: 105 });
  });

  it('cae al default de la plataforma si no hay ninguna regla', () => {
    const resultado = resolverTurno(local('2026-09-15T13:00'), 4, { ...config, reglas: [] });
    expect(resultado).toMatchObject({ tipo: 'ok', origenRegla: 'defecto', duracionMin: 120 });
  });
});

describe('excepciones del calendario', () => {
  it('un día marcado como cerrado no acepta reservas', () => {
    const resultado = resolverTurno(local('2026-09-15T21:00'), 2, {
      ...config,
      excepciones: [{ fecha: '2026-09-15', cerrado: true, motivo: 'Feriado' }],
    });
    expect(resultado).toEqual({ tipo: 'cerrado_ese_dia', motivo: 'Feriado' });
  });

  it('la madrugada pertenece al día de servicio anterior', () => {
    // Si el local cierra el martes y la cena termina a las 02:00, la reserva de la
    // 01:00 del miércoles es parte del martes y también está cerrada.
    const resultado = resolverTurno(local('2026-09-16T00:30'), 2, {
      ...config,
      excepciones: [{ fecha: '2026-09-15', cerrado: true, motivo: null }],
    });
    expect(resultado).toMatchObject({ tipo: 'cerrado_ese_dia' });
  });

  it('un horario especial reemplaza al de la franja solo ese día', () => {
    const conHorarioEspecial = {
      ...config,
      excepciones: [
        { fecha: '2026-09-15', cerrado: false, desde: '20:00', hasta: '22:00' },
      ],
    };
    expect(resolverTurno(local('2026-09-15T21:00'), 2, conHorarioEspecial))
      .toMatchObject({ tipo: 'ok' });
    // A las 23 ya cerró, aunque la cena normal siga hasta las 02:00.
    expect(resolverTurno(local('2026-09-15T23:00'), 2, conHorarioEspecial))
      .toEqual({ tipo: 'fuera_de_servicio' });
    // Y al día siguiente vuelve el horario de siempre.
    expect(resolverTurno(local('2026-09-16T23:00'), 2, conHorarioEspecial))
      .toMatchObject({ tipo: 'ok' });
  });

  it('un día sin excepción se comporta como siempre', () => {
    expect(resolverTurno(local('2026-09-15T21:00'), 2, { ...config, excepciones: [] }))
      .toMatchObject({ tipo: 'ok' });
  });
});

describe('el día de servicio', () => {
  it('el corte lo marca la franja que cierra más tarde', () => {
    expect(corteDelDia(config)).toBe(120); // la cena cierra a las 02:00
  });

  it('un local que cierra antes de medianoche no tiene corte', () => {
    const temprano = { ...config, franjas: [ALMUERZO] };
    expect(corteDelDia(temprano)).toBe(0);
  });

  it('la reserva de la 01:00 del miércoles es la noche del martes', () => {
    // Es el punto entero: el mozo que a la 01:00 sigue laburando está trabajando el
    // martes, y su planilla tiene que decir lo mismo.
    expect(diaDeServicio(local('2026-09-16T01:00'), config)).toBe('2026-09-15');
  });

  it('la cena de las 21:00 es del día en que empieza', () => {
    expect(diaDeServicio(local('2026-09-15T21:00'), config)).toBe('2026-09-15');
  });

  it('el almuerzo del día siguiente ya es el día siguiente', () => {
    expect(diaDeServicio(local('2026-09-16T13:00'), config)).toBe('2026-09-16');
  });

  it('pasado el cierre, la madrugada ya pertenece al día nuevo', () => {
    // A las 03:00 el local está cerrado hace una hora: eso ya es el miércoles.
    expect(diaDeServicio(local('2026-09-16T03:00'), config)).toBe('2026-09-16');
  });

  it('sin franjas que crucen medianoche, día de servicio y de almanaque coinciden', () => {
    const temprano = { ...config, franjas: [ALMUERZO] };
    expect(diaDeServicio(local('2026-09-16T01:00'), temprano)).toBe('2026-09-16');
  });
});

describe('el tiempo de limpieza', () => {
  it('arranca en cero: pasar un trapo no ocupa turno', () => {
    // Quince minutos por turno es una mesa entera por noche a la basura, y hace que un
    // turno de dos horas desde las 21:00 muestre la mesa ocupada a las 23:00.
    for (const regla of reglasSembradas('almuerzo', 'cena')) {
      expect(regla.bufferMin).toBe(0);
    }
  });

  it('el local que necesita margen lo puede poner igual', () => {
    const conMargen: ConfigTurnos = {
      ...config,
      reglas: [{ franjaId: null, personasMin: 1, personasMax: 99, duracionMin: 120, bufferMin: 30 }],
    };
    expect(resolverTurno(local('2026-09-15T21:00'), 4, conMargen)).toMatchObject({
      duracionMin: 120,
      bufferMin: 30,
    });
  });
});
