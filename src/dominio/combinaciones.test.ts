import { describe, expect, it } from 'vitest';
import { derivarCandidatos } from './combinaciones';
import { SALON } from './fixtures';
import { CONFIG_POR_DEFECTO } from './tipos';

const candidatos = derivarCandidatos(SALON, CONFIG_POR_DEFECTO);
const claves = new Set(candidatos.map((c) => c.clave));
const buscar = (clave: string) => candidatos.find((c) => c.clave === clave);

describe('derivarCandidatos', () => {
  it('une las mesas que están cerca y deja afuera las que están lejos', () => {
    expect(claves.has('t2+t2b')).toBe(true); // 200 cm
    expect(claves.has('t2b+t2c')).toBe(true); // 220 cm
    expect(claves.has('t2+t2c')).toBe(false); // 420 cm: hay que cruzar el salón
    expect(claves.has('t4+t6')).toBe(false);
  });

  it('acepta una cadena de tres aunque los extremos estén lejos entre sí', () => {
    // t2 y t2c están a 420 cm, pero t2b las une. Eso es armar una mesa larga, no
    // traer una mesa del otro extremo.
    expect(claves.has('t2+t2b+t2c')).toBe(true);
  });

  it('nunca combina mesas de salones distintos (D9)', () => {
    // x4 está en la terraza, en la misma coordenada que t2.
    expect([...claves].some((c) => c.includes('x4') && c.includes('+'))).toBe(false);
  });

  it('respeta las combinaciones vetadas', () => {
    const conVeto = derivarCandidatos(SALON, CONFIG_POR_DEFECTO, [['t2', 't2b']]);
    const clavesVeto = new Set(conVeto.map((c) => c.clave));
    expect(clavesVeto.has('t2+t2b')).toBe(false);
    // La cadena se corta: sin t2–t2b, t2 queda aislada de las otras dos.
    expect(clavesVeto.has('t2+t2b+t2c')).toBe(false);
    expect(clavesVeto.has('t2b+t2c')).toBe(true);
  });

  it('no mueve mesas fijas como la barra', () => {
    const conBarra = SALON.map((m) => (m.id === 't2b' ? { ...m, combinable: false } : m));
    const clavesBarra = new Set(derivarCandidatos(conBarra, CONFIG_POR_DEFECTO).map((c) => c.clave));
    expect(clavesBarra.has('t2+t2b')).toBe(false);
    expect(clavesBarra.has('t2b')).toBe(true); // sigue existiendo suelta
  });

  it('ignora las mesas dadas de baja', () => {
    const conBaja = SALON.map((m) => (m.id === 't6' ? { ...m, activa: false } : m));
    const clavesBaja = new Set(derivarCandidatos(conBaja, CONFIG_POR_DEFECTO).map((c) => c.clave));
    expect(clavesBaja.has('t6')).toBe(false);
  });

  it('una mesa de 4 con dos cabeceras sienta 6', () => {
    expect(buscar('t4')).toMatchObject({ capacidadNominal: 4, capacidadMax: 6 });
  });

  it('un combo suma las sillas pero solo conserva dos cabeceras', () => {
    const dosDeCuatro = derivarCandidatos(
      [
        { ...SALON[3]!, id: 'a', x: 0 },
        { ...SALON[3]!, id: 'b', x: 100 },
      ],
      CONFIG_POR_DEFECTO,
    ).find((c) => c.clave === 'a+b');
    // 4 + 4 sillas, y de las 4 cabeceras solo quedan las dos puntas del conjunto.
    expect(dosDeCuatro).toMatchObject({ capacidadNominal: 8, capacidadMax: 10 });
  });

  it('descuenta sillas por unión cuando el local lo configura así', () => {
    const config = { ...CONFIG_POR_DEFECTO, perdidaPorUnion: 1 };
    expect(derivarCandidatos(SALON, config).find((c) => c.clave === 't3a+t3b')).toMatchObject({
      capacidadNominal: 5,
    });
  });

  it('un combo no se ofrece si el grupo entraba en una sola de sus mesas', () => {
    // No tiene sentido proponer t3a+t3b para un grupo de 3.
    expect(buscar('t3a+t3b')?.capacidadMin).toBe(4);
    expect(buscar('t2+t2b')?.capacidadMin).toBe(3);
  });

  it('mide cuánto hay que arrimar las mesas hasta que se toquen', () => {
    // Entre bordes, no entre centros: t2 y t2b tienen los centros a 200 cm pero miden
    // 70 cm cada una, así que para juntarlas hay que moverlas 130.
    expect(buscar('t2+t2b')?.distanciaCm).toBe(130);
    expect(buscar('t2b+t2c')?.distanciaCm).toBe(150);
    expect(buscar('t2+t2b+t2c')?.distanciaCm).toBe(280); // 130 + 150, encadenadas
    expect(buscar('t6')?.distanciaCm).toBe(0);
  });

  it('dos mesas grandes pegadas se pueden unir', () => {
    // El error que esto evita: midiendo de centro a centro, dos mesas de ocho tocándose
    // tienen los centros a casi tres metros y el sistema no las unía nunca, mientras que
    // dos mesas de dos a la misma distancia real sí. Las mesas grandes, que son
    // justamente las que se juntan para los grupos grandes, quedaban afuera.
    const grandes = [
      { ...SALON[0]!, id: 'g1', nombre: 'g1', capacidadBase: 8, x: 0, y: 0 },
      { ...SALON[0]!, id: 'g2', nombre: 'g2', capacidadBase: 8, x: 300, y: 0 },
    ];
    const combo = derivarCandidatos(grandes, CONFIG_POR_DEFECTO).find((c) => c.clave === 'g1+g2');
    expect(combo).toBeDefined();
    expect(combo?.distanciaCm).toBe(20); // 300 de centro a centro, 280 de ancho entre las dos
    expect(combo?.capacidadMax).toBe(16);
  });

  it('dos mesas superpuestas están a distancia cero', () => {
    const encimadas = [
      { ...SALON[0]!, id: 'a', nombre: 'a', x: 100, y: 100 },
      { ...SALON[0]!, id: 'b', nombre: 'b', x: 100, y: 100 },
    ];
    expect(derivarCandidatos(encimadas, CONFIG_POR_DEFECTO).find((c) => c.clave === 'a+b'))
      .toMatchObject({ distanciaCm: 0 });
  });

  it('no se cuelga ni explota con un salón de 50 mesas pegadas', () => {
    const grilla = Array.from({ length: 50 }, (_, i) => ({
      ...SALON[0]!,
      id: `m${String(i).padStart(2, '0')}`,
      x: (i % 10) * 120,
      y: Math.floor(i / 10) * 120,
    }));
    const arranque = Date.now();
    const derivados = derivarCandidatos(grilla, CONFIG_POR_DEFECTO);
    expect(derivados.length).toBeGreaterThan(50);
    expect(Date.now() - arranque).toBeLessThan(1000);
  });
});
