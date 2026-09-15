import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { URL_ADMIN, pool } from '../datos/conexion';
import { crearLocal, type LocalCreado } from '../datos/semilla';
import {
  actualizarMesa, borrarMesa, borrarSalon, cambiarActivaMesa, cambiarMedidasSalon,
  cambiarRadioCombinacion, cargarPlanoCompleto, crearMesa, crearSalon, moverMesa,
  quitarVeto, vetarCombinacion,
} from './plano';
import { crearReserva } from './reservas';

const admin = new pg.Pool({ connectionString: URL_ADMIN });
const app = pool();
let local: LocalCreado;
let salonId: string;

const mesa = (nombre: string, x: number, extra = {}) => ({
  nombre, capacidadBase: 2, cabeceras: 0, capacidadMin: 1, x, y: 0,
  forma: 'rect' as const, combinable: true, ...extra,
});

beforeAll(async () => {
  local = await crearLocal(admin, {
    slug: `plano-${Date.now()}`, nombre: 'Bar Plano', salones: [],
  });
});

beforeEach(async () => {
  await admin.query('DELETE FROM reservas WHERE tenant_id = $1', [local.tenantId]);
  await admin.query('DELETE FROM mesas WHERE tenant_id = $1', [local.tenantId]);
  await admin.query('DELETE FROM salones WHERE tenant_id = $1', [local.tenantId]);
  // También la configuración: el radio de combinación queda guardado en el tenant y
  // si no se limpia, un test que lo cambia le arruina el escenario al siguiente. Sin
  // esto había tests que pasaban por el motivo equivocado.
  await admin.query(`UPDATE tenants SET config = '{}'::jsonb WHERE id = $1`, [local.tenantId]);
  salonId = (await crearSalon(app, local.tenantId, 'Planta baja')).id;
});

afterAll(async () => {
  await admin.query('DELETE FROM tenants WHERE id = $1', [local.tenantId]);
  await Promise.all([admin.end(), app.end()]);
});

describe('carga del salón', () => {
  it('crea salones y mesas y los devuelve agrupados', async () => {
    await crearMesa(app, local.tenantId, salonId, mesa('1', 0));
    await crearMesa(app, local.tenantId, salonId, mesa('2', 200));

    const plano = await cargarPlanoCompleto(app, local.tenantId);
    expect(plano.salones).toHaveLength(1);
    expect(plano.salones[0]!.mesas.map((m) => m.nombre)).toEqual(['1', '2']);
  });

  it('no deja repetir el nombre de una mesa en el mismo salón', async () => {
    await crearMesa(app, local.tenantId, salonId, mesa('1', 0));
    expect(await crearMesa(app, local.tenantId, salonId, mesa('1', 500)))
      .toEqual({ tipo: 'nombre_repetido' });
  });

  it('el mismo nombre sí puede repetirse en otro salón', async () => {
    const terraza = await crearSalon(app, local.tenantId, 'Terraza');
    await crearMesa(app, local.tenantId, salonId, mesa('1', 0));
    expect((await crearMesa(app, local.tenantId, terraza.id, mesa('1', 0))).tipo).toBe('ok');
  });

  it('rechaza datos que no tienen sentido, con el motivo', async () => {
    const casos: [Partial<ReturnType<typeof mesa>>, RegExp][] = [
      [{ nombre: '  ' }, /nombre/i],
      [{ capacidadBase: 0 }, /capacidad/i],
      [{ cabeceras: 5 }, /cabeceras/i],
      [{ capacidadMin: 9 }, /mínimo/i],
    ];
    for (const [cambio, esperado] of casos) {
      const r = await crearMesa(app, local.tenantId, salonId, { ...mesa('X', 0), ...cambio });
      expect(r.tipo).toBe('datos_invalidos');
      if (r.tipo === 'datos_invalidos') expect(r.motivo).toMatch(esperado);
    }
  });

  it('mover una mesa cambia su posición y nunca la deja en negativo', async () => {
    const creada = await crearMesa(app, local.tenantId, salonId, mesa('1', 0));
    if (creada.tipo !== 'ok') throw new Error('no se creó');

    await moverMesa(app, local.tenantId, creada.id, 340.7, -50);
    const plano = await cargarPlanoCompleto(app, local.tenantId);
    expect(plano.salones[0]!.mesas[0]).toMatchObject({ x: 341, y: 0 });
  });
});

describe('las combinaciones que el sistema deduce', () => {
  it('muestra lo que el motor va a poder armar con este plano', async () => {
    await crearMesa(app, local.tenantId, salonId, mesa('1', 0));
    await crearMesa(app, local.tenantId, salonId, mesa('2', 200));
    await crearMesa(app, local.tenantId, salonId, mesa('3', 900)); // lejos

    const plano = await cargarPlanoCompleto(app, local.tenantId);
    expect(plano.combinaciones.map((c) => c.etiqueta)).toEqual(['1+2']);
    expect(plano.combinaciones[0]).toMatchObject({
      capacidad: '4', distanciaCm: 130, salon: 'Planta baja',
    });
  });

  it('cambiar el radio cambia lo que se puede unir', async () => {
    await crearMesa(app, local.tenantId, salonId, mesa('1', 0));
    await crearMesa(app, local.tenantId, salonId, mesa('2', 400));

    expect((await cargarPlanoCompleto(app, local.tenantId)).combinaciones).toHaveLength(0);
    await cambiarRadioCombinacion(app, local.tenantId, 500);
    expect((await cargarPlanoCompleto(app, local.tenantId)).combinaciones
      .map((c) => c.etiqueta)).toEqual(['1+2']);
  });

  it('el radio se mantiene dentro de límites razonables', async () => {
    await cambiarRadioCombinacion(app, local.tenantId, 999999);
    expect((await cargarPlanoCompleto(app, local.tenantId)).config.radioCombinacionCm).toBe(1000);
    await cambiarRadioCombinacion(app, local.tenantId, 1);
    expect((await cargarPlanoCompleto(app, local.tenantId)).config.radioCombinacionCm).toBe(50);
  });

  it('una mesa fija no se une con nadie', async () => {
    await crearMesa(app, local.tenantId, salonId, mesa('1', 0));
    await crearMesa(app, local.tenantId, salonId, mesa('Barra', 200, { combinable: false }));
    expect((await cargarPlanoCompleto(app, local.tenantId)).combinaciones).toHaveLength(0);
  });

  it('vetar una combinación la saca de la lista y quitarle el veto la devuelve', async () => {
    const a = await crearMesa(app, local.tenantId, salonId, mesa('1', 0));
    const b = await crearMesa(app, local.tenantId, salonId, mesa('2', 200));
    if (a.tipo !== 'ok' || b.tipo !== 'ok') throw new Error('no se creó');

    await vetarCombinacion(app, local.tenantId, b.id, a.id, 'hay una columna');
    const conVeto = await cargarPlanoCompleto(app, local.tenantId);
    expect(conVeto.combinaciones).toHaveLength(0);
    expect(conVeto.vetadas[0]).toMatchObject({ nombreA: '1', nombreB: '2' });

    await quitarVeto(app, local.tenantId, a.id, b.id);
    expect((await cargarPlanoCompleto(app, local.tenantId)).combinaciones).toHaveLength(1);
  });
});

describe('borrar sin romper nada', () => {
  it('no borra una mesa que tiene gente esperando sentarse', async () => {
    const creada = await crearMesa(app, local.tenantId, salonId,
      { ...mesa('1', 0), capacidadBase: 4 });
    if (creada.tipo !== 'ok') throw new Error('no se creó');

    const reserva = await crearReserva(app, {
      tenantId: local.tenantId,
      inicio: new Date(Date.now() + 26 * 3600_000),
      personas: 2, canalOrigen: 'manual', actor: { tipo: 'staff', id: null },
      contacto: { nombre: 'Ana', telefono: '1155550001' },
    });
    // Puede caer fuera de horario según la hora del día; solo interesa cuando entró.
    if (reserva.tipo === 'creada') {
      expect(await borrarMesa(app, local.tenantId, creada.id))
        .toEqual({ tipo: 'tiene_reservas', reservas: 1 });

      // Lo correcto en ese caso es desactivarla: deja de ofrecerse, lo reservado sigue.
      await cambiarActivaMesa(app, local.tenantId, creada.id, false);
      const plano = await cargarPlanoCompleto(app, local.tenantId);
      expect(plano.salones[0]!.mesas.find((m) => m.id === creada.id)?.activa).toBe(false);
    }
  });

  it('borra una mesa sin reservas', async () => {
    const creada = await crearMesa(app, local.tenantId, salonId, mesa('1', 0));
    if (creada.tipo !== 'ok') throw new Error('no se creó');
    expect(await borrarMesa(app, local.tenantId, creada.id)).toEqual({ tipo: 'borrado' });
    expect((await cargarPlanoCompleto(app, local.tenantId)).salones[0]!.mesas).toHaveLength(0);
  });

  it('no borra un salón que todavía tiene mesas', async () => {
    await crearMesa(app, local.tenantId, salonId, mesa('1', 0));
    expect(await borrarSalon(app, local.tenantId, salonId))
      .toEqual({ tipo: 'tiene_mesas', mesas: 1 });
  });

  it('borra un salón vacío', async () => {
    expect(await borrarSalon(app, local.tenantId, salonId)).toEqual({ tipo: 'borrado' });
    expect((await cargarPlanoCompleto(app, local.tenantId)).salones).toHaveLength(0);
  });
});

describe('editar una mesa', () => {
  it('cambia capacidad y cabeceras, y eso se ve en las combinaciones', async () => {
    const a = await crearMesa(app, local.tenantId, salonId, mesa('1', 0));
    await crearMesa(app, local.tenantId, salonId, mesa('2', 200));
    if (a.tipo !== 'ok') throw new Error('no se creó');

    await actualizarMesa(app, local.tenantId, a.id, {
      ...mesa('1', 0), capacidadBase: 4, cabeceras: 2,
    });
    const plano = await cargarPlanoCompleto(app, local.tenantId);
    expect(plano.salones[0]!.mesas.find((m) => m.id === a.id))
      .toMatchObject({ capacidadBase: 4, cabeceras: 2 });
    // 4 + 2 sillas, más las dos cabeceras del conjunto.
    expect(plano.combinaciones[0]!.capacidad).toBe('6–8');
  });
});

describe('forma de la mesa', () => {
  it('guarda la forma y la devuelve', async () => {
    await crearMesa(app, local.tenantId, salonId, mesa('R', 0, { forma: 'redonda' }));
    await crearMesa(app, local.tenantId, salonId, mesa('C', 400, { forma: 'cuadrada' }));
    const plano = await cargarPlanoCompleto(app, local.tenantId);
    expect(plano.salones[0]!.mesas.map((m) => [m.nombre, m.forma])).toEqual([
      ['C', 'cuadrada'], ['R', 'redonda'],
    ]);
  });

  it('una mesa redonda no puede tener cabeceras', async () => {
    // No es un capricho: una mesa redonda no tiene puntas donde sumar una silla.
    const r = await crearMesa(app, local.tenantId, salonId,
      mesa('R', 0, { forma: 'redonda', cabeceras: 2 }));
    expect(r.tipo).toBe('datos_invalidos');
    if (r.tipo === 'datos_invalidos') expect(r.motivo).toMatch(/redonda/i);
  });
});

describe('cabeceras al unir mesas', () => {
  it('dos mesas con dos cabeceras cada una no suman cuatro, suman dos', async () => {
    // Las cabeceras del medio quedan contra la otra mesa: dejan de ser lugares.
    await crearMesa(app, local.tenantId, salonId,
      mesa('A', 0, { capacidadBase: 4, cabeceras: 2 }));
    await crearMesa(app, local.tenantId, salonId,
      mesa('B', 200, { capacidadBase: 4, cabeceras: 2 }));

    const plano = await cargarPlanoCompleto(app, local.tenantId);
    // 4 + 4 sillas, y solo dos cabeceras para todo el conjunto: 8 a 10, no 8 a 12.
    expect(plano.combinaciones[0]).toMatchObject({ etiqueta: 'A+B', capacidad: '8–10' });
  });
});

describe('medidas del salón', () => {
  it('agrandar y achicar, dentro de límites razonables', async () => {
    expect(await cambiarMedidasSalon(app, local.tenantId, salonId, 2000, 1500))
      .toEqual({ anchoCm: 2000, altoCm: 1500 });

    const plano = await cargarPlanoCompleto(app, local.tenantId);
    expect(plano.salones[0]).toMatchObject({ anchoCm: 2000, altoCm: 1500 });

    expect(await cambiarMedidasSalon(app, local.tenantId, salonId, 999999, 1))
      .toEqual({ anchoCm: 10000, altoCm: 200 });
  });

  it('al achicar el salón, las mesas que quedaban afuera se traen adentro', async () => {
    // Una mesa fuera del dibujo no se puede arrastrar de vuelta porque no se ve.
    await cambiarMedidasSalon(app, local.tenantId, salonId, 3000, 2000);
    await crearMesa(app, local.tenantId, salonId, { ...mesa('Lejos', 2800), y: 1900 });

    await cambiarMedidasSalon(app, local.tenantId, salonId, 1000, 600);
    const plano = await cargarPlanoCompleto(app, local.tenantId);
    expect(plano.salones[0]!.mesas[0]).toMatchObject({ x: 1000, y: 600 });
  });

  it('una mesa no se puede mover fuera del salón', async () => {
    await cambiarMedidasSalon(app, local.tenantId, salonId, 1000, 600);
    const creada = await crearMesa(app, local.tenantId, salonId, mesa('1', 100));
    if (creada.tipo !== 'ok') throw new Error('no se creó');

    await moverMesa(app, local.tenantId, creada.id, 99999, -500);
    const plano = await cargarPlanoCompleto(app, local.tenantId);
    expect(plano.salones[0]!.mesas[0]).toMatchObject({ x: 1000, y: 0 });
  });
});

describe('por qué dos mesas no se unen', () => {
  it('explica que están lejos, con la distancia real entre bordes', async () => {
    await crearMesa(app, local.tenantId, salonId, mesa('1', 0));
    await crearMesa(app, local.tenantId, salonId, mesa('2', 400));

    const plano = await cargarPlanoCompleto(app, local.tenantId);
    expect(plano.combinaciones).toHaveLength(0);
    expect(plano.noSeUnen[0]).toMatchObject({ etiqueta: '1 + 2', separacionCm: 330 });
    expect(plano.noSeUnen[0]!.motivo).toMatch(/3\.30 m.*2\.50 m/);
  });

  it('explica que una está marcada como fija', async () => {
    await crearMesa(app, local.tenantId, salonId, mesa('1', 0));
    await crearMesa(app, local.tenantId, salonId, mesa('Barra', 200, { combinable: false }));

    const plano = await cargarPlanoCompleto(app, local.tenantId);
    expect(plano.noSeUnen[0]).toMatchObject({ etiqueta: '1 + Barra' });
    expect(plano.noSeUnen[0]!.motivo).toMatch(/Barra está marcada como fija/);
  });

  it('explica que el par fue marcado como imposible', async () => {
    const a = await crearMesa(app, local.tenantId, salonId, mesa('1', 0));
    const b = await crearMesa(app, local.tenantId, salonId, mesa('2', 200));
    if (a.tipo !== 'ok' || b.tipo !== 'ok') throw new Error('no se creó');

    await vetarCombinacion(app, local.tenantId, a.id, b.id);
    const plano = await cargarPlanoCompleto(app, local.tenantId);
    expect(plano.noSeUnen[0]!.motivo).toMatch(/imposibles de unir/);
  });

  it('no dice nada de las que sí se unen', async () => {
    await crearMesa(app, local.tenantId, salonId, mesa('1', 0));
    await crearMesa(app, local.tenantId, salonId, mesa('2', 200));
    const plano = await cargarPlanoCompleto(app, local.tenantId);
    expect(plano.combinaciones).toHaveLength(1);
    expect(plano.noSeUnen).toHaveLength(0);
  });

  it('dos mesas de ocho pegadas se unen, y no aparecen como problema', async () => {
    // El caso que motivó medir entre bordes: de centro a centro quedaban a 3 m.
    await crearMesa(app, local.tenantId, salonId,
      mesa('G1', 0, { capacidadBase: 8, capacidadMin: 1 }));
    await crearMesa(app, local.tenantId, salonId,
      mesa('G2', 300, { capacidadBase: 8, capacidadMin: 1 }));

    const plano = await cargarPlanoCompleto(app, local.tenantId);
    expect(plano.combinaciones.map((c) => c.etiqueta)).toEqual(['G1+G2']);
    expect(plano.noSeUnen).toHaveLength(0);
  });
});
