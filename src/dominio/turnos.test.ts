import { describe, expect, it } from 'vitest';
import { ALMUERZO, CENA, TZ, local } from './fixtures';
import type { DiaSemana } from './tipos';
import {
  corteDelDia,
  diaDeServicio,
  reglasSembradas,
  resolverTurno,
  type ConfigTurnos,
  type ExcepcionCalendario,
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

describe('días especiales', () => {
  const conExcepciones = (excepciones: ExcepcionCalendario[]): ConfigTurnos => ({
    ...config,
    excepciones,
  });

  it('un día especial puede abrir ANTES de lo habitual', () => {
    // El caso que antes no se podía decir: la cena arranca 20:00, pero el 21/09 se
    // abre a las 18:00. La regla vieja solo sabía recortar.
    const c = conExcepciones([
      { fecha: '2026-09-15', cerrado: false, desde: '18:00', hasta: '23:00', motivo: 'Evento' },
    ]);

    expect(resolverTurno(local('2026-09-15T18:30'), 2, c)).toMatchObject({
      tipo: 'ok',
      franjaNombre: 'Evento',
    });
  });

  it('y reemplaza el horario habitual, no lo suma', () => {
    // A las 21:00 normalmente hay cena. Ese día el servicio termina a las 20:00.
    const c = conExcepciones([
      { fecha: '2026-09-15', cerrado: false, desde: '11:00', hasta: '20:00' },
    ]);

    expect(resolverTurno(local('2026-09-15T12:00'), 2, c)).toMatchObject({ tipo: 'ok' });
    expect(resolverTurno(local('2026-09-15T21:00'), 2, c)).toEqual({ tipo: 'fuera_de_servicio' });
  });

  it('un día especial puede tener más de un tramo', () => {
    const c = conExcepciones([
      { fecha: '2026-09-15', cerrado: false, desde: '11:00', hasta: '15:00', motivo: 'Brunch' },
      { fecha: '2026-09-15', cerrado: false, desde: '18:00', hasta: '02:00', motivo: 'Fiesta' },
    ]);

    expect(resolverTurno(local('2026-09-15T11:30'), 2, c)).toMatchObject({ franjaNombre: 'Brunch' });
    expect(resolverTurno(local('2026-09-15T19:00'), 2, c)).toMatchObject({ franjaNombre: 'Fiesta' });
    // Entre los dos tramos el local está cerrado.
    expect(resolverTurno(local('2026-09-15T16:30'), 2, c)).toEqual({ tipo: 'fuera_de_servicio' });
  });

  it('puede abrir un día en el que normalmente está cerrado', () => {
    const soloSabados = {
      ...config,
      franjas: [{ ...CENA, dias: [6 as DiaSemana] }],
      // 2026-09-15 es martes: sin excepción, no abre.
      excepciones: [
        { fecha: '2026-09-15', cerrado: false, desde: '20:00', hasta: '01:00', motivo: 'Especial' },
      ],
    };

    expect(resolverTurno(local('2026-09-15T21:00'), 2, soloSabados)).toMatchObject({
      tipo: 'ok',
      franjaNombre: 'Especial',
    });
  });

  it('un día cerrado se explica distinto que una hora sin servicio', () => {
    // No es lo mismo elegir mal la hora que caer un día que el local no abre.
    const c = conExcepciones([{ fecha: '2026-09-15', cerrado: true, motivo: 'Feriado' }]);

    expect(resolverTurno(local('2026-09-15T21:00'), 2, c)).toEqual({
      tipo: 'cerrado_ese_dia',
      motivo: 'Feriado',
    });
    expect(resolverTurno(local('2026-09-15T18:00'), 2, c)).toEqual({ tipo: 'fuera_de_servicio' });
  });

  it('cerrar el 25 también cierra la madrugada del 26', () => {
    // La cena del 25 termina a las 02:00 del 26: esa reserva pertenece al 25 y está
    // cerrada igual, aunque el reloj ya marque otro día.
    const c = conExcepciones([{ fecha: '2026-09-15', cerrado: true, motivo: 'Navidad' }]);

    expect(resolverTurno(local('2026-09-16T01:00'), 2, c)).toEqual({
      tipo: 'cerrado_ese_dia',
      motivo: 'Navidad',
    });
  });

  it('el día especial usa las reglas de duración de la franja que se le indique', () => {
    const c = conExcepciones([
      {
        fecha: '2026-09-15', cerrado: false, desde: '18:00', hasta: '23:00',
        motivo: 'Evento', franjaId: 'almuerzo',
      },
    ]);
    // Con la franja del almuerzo, un grupo de 4 rota en 90 y no en 105.
    expect(resolverTurno(local('2026-09-15T18:30'), 4, c)).toMatchObject({ duracionMin: 90 });
  });

  it('sin último ingreso propio, se acepta gente hasta que cierra', () => {
    const c = conExcepciones([
      { fecha: '2026-09-15', cerrado: false, desde: '18:00', hasta: '23:00' },
    ]);

    expect(resolverTurno(local('2026-09-15T22:45'), 2, c)).toMatchObject({ tipo: 'ok' });
    expect(resolverTurno(local('2026-09-15T23:00'), 2, c)).toEqual({ tipo: 'fuera_de_servicio' });
  });

  it('con último ingreso propio, corta antes', () => {
    const c = conExcepciones([
      {
        fecha: '2026-09-15', cerrado: false, desde: '18:00', hasta: '23:00',
        ultimoIngreso: '21:00',
      },
    ]);

    expect(resolverTurno(local('2026-09-15T21:30'), 2, c)).toMatchObject({
      tipo: 'despues_del_ultimo_ingreso',
      ultimoIngreso: '21:00',
    });
  });

  it('el día especial de otra fecha no toca este', () => {
    const c = conExcepciones([{ fecha: '2026-12-26', cerrado: true, motivo: 'Cerrado' }]);
    expect(resolverTurno(local('2026-09-15T21:00'), 2, c)).toMatchObject({ tipo: 'ok' });
  });
});
