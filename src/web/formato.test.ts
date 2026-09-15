import { describe, expect, it } from 'vitest';
import { hoyEn, instanteLocal, sumarDias } from './formato';

const BA = 'America/Argentina/Buenos_Aires';
const MADRID = 'Europe/Madrid';

describe('instanteLocal', () => {
  it('interpreta la hora en la zona del local, no en la del servidor', () => {
    // El contenedor corre en UTC: sin esto, las 21:00 de Buenos Aires se guardarían
    // como las 21:00 UTC, o sea las 18:00 locales.
    expect(instanteLocal('2026-10-10', '21:00', BA).toISOString()).toBe(
      '2026-10-11T00:00:00.000Z',
    );
  });

  it('respeta el horario de verano de una zona que lo tiene', () => {
    // Madrid: UTC+2 en julio, UTC+1 en enero. Argentina no tiene DST hoy, pero si el
    // primer cliente de afuera sí lo tiene y el modelo asume que no, se rompe en silencio.
    expect(instanteLocal('2026-07-15', '21:00', MADRID).toISOString()).toBe(
      '2026-07-15T19:00:00.000Z',
    );
    expect(instanteLocal('2026-01-15', '21:00', MADRID).toISOString()).toBe(
      '2026-01-15T20:00:00.000Z',
    );
  });

  it('maneja la reserva de madrugada sin correr el día', () => {
    expect(instanteLocal('2026-10-11', '00:30', BA).toISOString()).toBe(
      '2026-10-11T03:30:00.000Z',
    );
  });

  it('es la inversa de leer la hora local', () => {
    for (const hora of ['00:00', '08:15', '13:45', '21:30', '23:59']) {
      const instante = instanteLocal('2026-10-10', hora, BA);
      const leida = new Intl.DateTimeFormat('en-GB', {
        timeZone: BA, hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(instante);
      expect(leida).toBe(hora);
    }
  });
});

describe('sumarDias', () => {
  it('avanza y retrocede días sin caerse en los bordes de mes', () => {
    expect(sumarDias('2026-10-31', 1)).toBe('2026-11-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(sumarDias('2028-03-01', -1)).toBe('2028-02-29'); // bisiesto
  });
});

describe('hoyEn', () => {
  it('devuelve el día calendario de la zona pedida', () => {
    expect(hoyEn(BA)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
