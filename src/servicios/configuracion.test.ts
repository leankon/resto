import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { URL_ADMIN, pool } from '../datos/conexion';
import { crearLocal, type LocalCreado } from '../datos/semilla';
import {
  borrarDuracion,
  borrarExcepcion,
  borrarFranja,
  cambiarActivaFranja,
  cargarConfiguracion,
  guardarDuracion,
  guardarExcepcion,
  guardarFranja,
  ponerDuracionPareja,
  renombrarLocal,
} from './configuracion';
import { crearReserva } from './reservas';

const admin = new pg.Pool({ connectionString: URL_ADMIN });
const app = pool();
let local: LocalCreado;

const cena = () => ({
  nombre: 'Cena', dias: [0, 1, 2, 3, 4, 5, 6] as never,
  desde: '20:00', hasta: '02:00', ultimoIngreso: '01:00',
});

beforeAll(async () => {
  local = await crearLocal(admin, { slug: `cfg-${Date.now()}`, nombre: 'Bar Config', salones: [] });
});
beforeEach(async () => {
  await admin.query('DELETE FROM excepciones_calendario WHERE tenant_id = $1', [local.tenantId]);
});
afterAll(async () => {
  await admin.query('DELETE FROM tenants WHERE id = $1', [local.tenantId]);
  await Promise.all([admin.end(), app.end()]);
});

describe('franjas de servicio', () => {
  it('trae las que se sembraron al dar de alta el local', async () => {
    const config = await cargarConfiguracion(app, local.tenantId);
    expect(config.franjas.map((f) => f.nombre)).toEqual(['Almuerzo', 'Cena']);
    // La cena cierra a las 02:00: el panel tiene que poder avisarlo.
    expect(config.franjas.find((f) => f.nombre === 'Cena')?.cruzaMedianoche).toBe(true);
    expect(config.franjas.find((f) => f.nombre === 'Almuerzo')?.cruzaMedianoche).toBe(false);
  });

  it('crea una franja nueva', async () => {
    expect(await guardarFranja(app, local.tenantId, {
      nombre: 'Brunch', dias: [0, 6] as never, desde: '10:00', hasta: '13:00',
      ultimoIngreso: '12:00',
    })).toEqual({ tipo: 'ok' });

    const config = await cargarConfiguracion(app, local.tenantId);
    expect(config.franjas.find((f) => f.nombre === 'Brunch')).toMatchObject({
      dias: [0, 6], desde: '10:00', hasta: '13:00',
    });
  });

  it('rechaza una franja sin días, sin nombre o con horas imposibles', async () => {
    const casos: [Partial<ReturnType<typeof cena>>, RegExp][] = [
      [{ nombre: ' ' }, /nombre/i],
      [{ dias: [] as never }, /día/i],
      [{ desde: '20:00', hasta: '20:00' }, /misma/i],
      [{ ultimoIngreso: '12:00' }, /último ingreso/i],
    ];
    for (const [cambio, esperado] of casos) {
      const r = await guardarFranja(app, local.tenantId, { ...cena(), ...cambio });
      expect(r.tipo).toBe('invalido');
      if (r.tipo === 'invalido') expect(r.motivo).toMatch(esperado);
    }
  });

  it('acepta un último ingreso de madrugada en una franja que cruza medianoche', async () => {
    // 01:00 es "después" de las 20:00 aunque el número sea menor.
    expect(await guardarFranja(app, local.tenantId, { ...cena(), ultimoIngreso: '01:00' }))
      .toEqual({ tipo: 'ok' });
  });

  it('no deja borrar la última franja', async () => {
    const config = await cargarConfiguracion(app, local.tenantId);
    for (const f of config.franjas.slice(0, -1)) {
      expect(await borrarFranja(app, local.tenantId, f.id)).toEqual({ tipo: 'borrada' });
    }
    const queda = (await cargarConfiguracion(app, local.tenantId)).franjas[0]!;
    // Sin ninguna franja el local no acepta reservas a ninguna hora: es apagarlo sin avisar.
    expect(await borrarFranja(app, local.tenantId, queda.id)).toEqual({ tipo: 'es_la_ultima' });

    await guardarFranja(app, local.tenantId, {
      nombre: 'Almuerzo', dias: [0, 1, 2, 3, 4, 5, 6] as never,
      desde: '12:00', hasta: '16:00', ultimoIngreso: '15:00',
    });
    await guardarFranja(app, local.tenantId, cena());
  });

  it('desactivar una franja la deja sin aceptar reservas', async () => {
    const config = await cargarConfiguracion(app, local.tenantId);
    const laCena = config.franjas.find((f) => f.nombre === 'Cena')!;
    await cambiarActivaFranja(app, local.tenantId, laCena.id, false);
    expect((await cargarConfiguracion(app, local.tenantId)).franjas
      .find((f) => f.id === laCena.id)?.activa).toBe(false);
    await cambiarActivaFranja(app, local.tenantId, laCena.id, true);
  });
});

describe('duración de los turnos', () => {
  it('cambia cuánto ocupa la mesa un grupo', async () => {
    const config = await cargarConfiguracion(app, local.tenantId);
    const regla = config.duraciones[0]!;
    expect(await guardarDuracion(app, local.tenantId, {
      franjaId: regla.franjaId, personasMin: regla.personasMin, personasMax: regla.personasMax,
      duracionMin: 60, bufferMin: 10,
    }, regla.id)).toEqual({ tipo: 'ok' });

    const despues = await cargarConfiguracion(app, local.tenantId);
    expect(despues.duraciones.find((d) => d.id === regla.id))
      .toMatchObject({ duracionMin: 60, bufferMin: 10 });
  });

  it('rechaza duraciones y rangos que no tienen sentido', async () => {
    const base = { franjaId: null, personasMin: 1, personasMax: 2, duracionMin: 90, bufferMin: 15 };
    const casos: [Partial<typeof base>, RegExp][] = [
      [{ personasMin: 0 }, /personas/i],
      [{ personasMin: 5, personasMax: 2 }, /personas/i],
      [{ duracionMin: 5 }, /duración/i],
      [{ duracionMin: 900 }, /duración/i],
      [{ bufferMin: 500 }, /limpieza/i],
    ];
    for (const [cambio, esperado] of casos) {
      const r = await guardarDuracion(app, local.tenantId, { ...base, ...cambio });
      expect(r.tipo).toBe('invalido');
      if (r.tipo === 'invalido') expect(r.motivo).toMatch(esperado);
    }
  });

  it('borra una regla', async () => {
    const antes = await cargarConfiguracion(app, local.tenantId);
    await borrarDuracion(app, local.tenantId, antes.duraciones[0]!.id);
    expect((await cargarConfiguracion(app, local.tenantId)).duraciones)
      .toHaveLength(antes.duraciones.length - 1);
  });
});

describe('días especiales', () => {
  it('marca un día como cerrado y el motor deja de aceptar reservas', async () => {
    expect(await guardarExcepcion(app, local.tenantId, {
      fecha: '2026-12-25', cerrado: true, motivo: 'Navidad',
    })).toEqual({ tipo: 'ok' });

    const resultado = await crearReserva(app, {
      tenantId: local.tenantId,
      inicio: new Date('2026-12-25T21:00:00-03:00'),
      personas: 2, canalOrigen: 'manual', actor: { tipo: 'staff', id: null },
      contacto: { nombre: 'Ana', telefono: '1155551111' },
    });
    expect(resultado).toEqual({ tipo: 'cerrado_ese_dia', motivo: 'Navidad' });
  });

  it('volver a guardar el mismo día lo reemplaza en vez de duplicarlo', async () => {
    await guardarExcepcion(app, local.tenantId, { fecha: '2026-12-25', cerrado: true });
    await guardarExcepcion(app, local.tenantId, {
      fecha: '2026-12-25', cerrado: false, desde: '20:00', hasta: '23:00', motivo: 'Horario corto',
    });
    const config = await cargarConfiguracion(app, local.tenantId);
    const navidad = config.excepciones.filter((e) => e.fecha === '2026-12-25');
    expect(navidad).toHaveLength(1);
    expect(navidad[0]).toMatchObject({ cerrado: false, desde: '20:00', motivo: 'Horario corto' });
  });

  it('pide el horario si el día no está cerrado', async () => {
    const r = await guardarExcepcion(app, local.tenantId, { fecha: '2026-12-31', cerrado: false });
    expect(r.tipo).toBe('invalido');
    if (r.tipo === 'invalido') expect(r.motivo).toMatch(/hora/i);
  });

  it('rechaza una fecha que no es una fecha', async () => {
    expect(await guardarExcepcion(app, local.tenantId, { fecha: 'mañana', cerrado: true }))
      .toMatchObject({ tipo: 'invalido' });
  });

  it('quitar el día especial lo vuelve a habilitar', async () => {
    await guardarExcepcion(app, local.tenantId, { fecha: '2026-12-25', cerrado: true });
    const config = await cargarConfiguracion(app, local.tenantId);
    await borrarExcepcion(app, local.tenantId, config.excepciones[0]!.id);
    expect((await cargarConfiguracion(app, local.tenantId)).excepciones).toHaveLength(0);
  });
});

describe('datos del local', () => {
  it('cambia el nombre y rechaza uno vacío', async () => {
    expect(await renombrarLocal(app, local.tenantId, 'Bar Nuevo')).toEqual({ tipo: 'ok' });
    expect((await cargarConfiguracion(app, local.tenantId)).nombre).toBe('Bar Nuevo');
    expect(await renombrarLocal(app, local.tenantId, '   ')).toMatchObject({ tipo: 'invalido' });
  });
});

describe('ponerDuracionPareja', () => {
  it('deja todas las reglas con la misma duración de un golpe', async () => {
    const antes = await cargarConfiguracion(app, local.tenantId);
    expect(new Set(antes.duraciones.map((d) => d.duracionMin)).size).toBeGreaterThan(1);

    expect(await ponerDuracionPareja(app, local.tenantId, 120, 20)).toEqual({ tipo: 'ok' });

    const despues = await cargarConfiguracion(app, local.tenantId);
    expect(despues.duraciones.every((d) => d.duracionMin === 120)).toBe(true);
    expect(despues.duraciones.every((d) => d.bufferMin === 20)).toBe(true);
    // No borra reglas: los tramos por tamaño de grupo siguen ahí para afinarlos después.
    expect(despues.duraciones).toHaveLength(antes.duraciones.length);
  });

  it('rechaza una duración absurda sin tocar nada', async () => {
    await ponerDuracionPareja(app, local.tenantId, 120, 15);
    const resultado = await ponerDuracionPareja(app, local.tenantId, 5, 15);

    expect(resultado).toMatchObject({ tipo: 'invalido' });
    const config = await cargarConfiguracion(app, local.tenantId);
    expect(config.duraciones.every((d) => d.duracionMin === 120)).toBe(true);
  });
});
