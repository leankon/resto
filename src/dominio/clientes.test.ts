import { describe, expect, it } from 'vitest';
import { identificar, normalizarEmail, normalizarTelefono } from './clientes.js';

describe('normalizarTelefono', () => {
  it('reconoce el mismo celular argentino tipeado de cualquier manera', () => {
    const formas = [
      '011 15 2345-6789',
      '+54 9 11 2345-6789',
      '+5491123456789',
      '1123456789',
      '11 2345 6789',
      '(011) 2345-6789',
    ];
    const claves = new Set(formas.map((f) => normalizarTelefono(f, 'AR')?.clave));
    expect(claves).toEqual(new Set(['+541123456789']));
  });

  it('conserva el formato canónico para poder contactarlo', () => {
    // La clave sirve para reconocerlo; el E.164 es el que se marca.
    expect(normalizarTelefono('011 15 2345-6789', 'AR')?.e164).toBe('+5491123456789');
  });

  it('acepta un número internacional aunque el país del local sea otro', () => {
    expect(normalizarTelefono('+1 415 555 2671', 'AR')).toMatchObject({
      e164: '+14155552671',
      clave: '+14155552671',
    });
  });

  it('descarta lo que no es un teléfono', () => {
    for (const basura of ['', '   ', 'no tengo', '123', null, undefined]) {
      expect(normalizarTelefono(basura, 'AR')).toBeNull();
    }
  });
});

describe('normalizarEmail', () => {
  it('normaliza mayúsculas y espacios', () => {
    expect(normalizarEmail('  Juan.Perez@Gmail.COM ')).toBe('juan.perez@gmail.com');
  });

  it('descarta lo que claramente no es un mail', () => {
    for (const basura of ['juan', 'juan@', '@gmail.com', '', null]) {
      expect(normalizarEmail(basura)).toBeNull();
    }
  });
});

describe('identificar', () => {
  it('el teléfono manda sobre el mail', () => {
    expect(identificar({ nombre: 'Ana', telefono: '1123456789', email: 'ana@x.com' }, 'AR'))
      .toMatchObject({ tipo: 'telefono', clave: '+541123456789', email: 'ana@x.com' });
  });

  it('usa el mail cuando no dejó teléfono', () => {
    expect(identificar({ nombre: 'Ana', email: 'ana@x.com' }, 'AR'))
      .toMatchObject({ tipo: 'email', email: 'ana@x.com' });
  });

  it('cae en un teléfono inválido al mail, en vez de fallar', () => {
    expect(identificar({ nombre: 'Ana', telefono: 'no tengo', email: 'ana@x.com' }, 'AR'))
      .toMatchObject({ tipo: 'email' });
  });

  it('marca explícitamente al cliente sin ningún dato de contacto', () => {
    // No es un error: es una reserva que nadie va a poder avisar, y el panel
    // tiene que poder mostrarlo.
    expect(identificar({ nombre: 'Ana' }, 'AR')).toEqual({ tipo: 'sin_contacto' });
  });
});
