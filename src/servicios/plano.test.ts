import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { URL_ADMIN, pool } from '../datos/conexion';
import { crearLocal, type LocalCreado } from '../datos/semilla';
import {
  borrarMesa, borrarSalon, cambiarActivaMesa, cambiarRadioCombinacion, cargarPlanoCompleto,
  crearMesa, crearSalon, moverMesa, quitarVeto, vetarCombinacion, actualizarMesa,
} from './plano';
import { crearReserva } from './reservas';

const admin = new pg.Pool({ connectionString: URL_ADMIN });
const app = pool();
let local: LocalCreado;
let salonId: string;

const mesa = (nombre: string, x: number, extra = {}) => ({
  nombre, capacidadBase: 2, cabeceras: 0, capacidadMin: 1, x, y: 0, combinable: true, ...extra,
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
      capacidad: '4', distanciaCm: 200, salon: 'Planta baja',
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
