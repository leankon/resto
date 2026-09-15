import { describe, expect, it } from 'vitest';
import { ALMUERZO, CENA, TZ, local } from './fixtures';
import { reglasSembradas, resolverTurno, type ConfigTurnos } from './turnos';

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

    expect(pareja).toMatchObject({ tipo: 'ok', duracionMin: 90, bufferMin: 15 });
    expect(grupo).toMatchObject({ tipo: 'ok', duracionMin: 150, bufferMin: 20 });
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
