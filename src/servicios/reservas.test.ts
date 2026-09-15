import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { URL_ADMIN, pool } from '../datos/conexion';
import { SALON_DEMO, crearLocal, type LocalCreado } from '../datos/semilla';
import { cambiarEstado, crearReserva, ocuparMesa, reasignarMesa } from './reservas';

const admin = new pg.Pool({ connectionString: URL_ADMIN });
const app = pool();
const STAFF = { tipo: 'staff' as const, id: null };

let local: LocalCreado;

/** Hora local del local (UTC-3). Un sábado cualquiera, dentro de la cena. */
const cena = (hora = '21:00') => new Date(`2026-10-10T${hora}:00-03:00`);

const base = {
  personas: 2,
  canalOrigen: 'web' as const,
  actor: STAFF,
  contacto: { nombre: 'Ana', telefono: '011 15 2345-6789' },
};

beforeAll(async () => {
  local = await crearLocal(admin, {
    slug: `demo-${Date.now()}`,
    nombre: 'Bar Demo',
    salones: SALON_DEMO,
  });
});

beforeEach(async () => {
  await admin.query('DELETE FROM reservas WHERE tenant_id = $1', [local.tenantId]);
  await admin.query('DELETE FROM clientes WHERE tenant_id = $1', [local.tenantId]);
});

afterAll(async () => {
  await admin.query('DELETE FROM tenants WHERE id = $1', [local.tenantId]);
  await Promise.all([admin.end(), app.end()]);
});

const reservar = (extra: Partial<Parameters<typeof crearReserva>[1]> = {}) =>
  crearReserva(app, { tenantId: local.tenantId, inicio: cena(), ...base, ...extra });

describe('crearReserva', () => {
  it('asigna la mesa que corresponde y crea al cliente', async () => {
    const resultado = await reservar();
    expect(resultado).toMatchObject({ tipo: 'creada', duracionMin: 90 });
    if (resultado.tipo !== 'creada') throw new Error('no asignó');

    expect(resultado.mesas.map((m) => m.nombre)).toEqual(['1']); // la mesa de 2
    expect(resultado.cliente).toMatchObject({ esNuevo: true, telefonoE164: '+5491123456789' });
  });

  it('reconoce al cliente que vuelve aunque escriba el teléfono distinto', async () => {
    const primera = await reservar();
    const segunda = await reservar({
      inicio: cena('22:00'),
      contacto: { nombre: 'Ana Pérez', telefono: '1123456789' },
    });
    if (primera.tipo !== 'creada' || segunda.tipo !== 'creada') throw new Error('no asignó');

    expect(segunda.cliente.id).toBe(primera.cliente.id);
    expect(segunda.cliente.esNuevo).toBe(false);
    expect(segunda.cliente.nombre).toBe('Ana Pérez'); // se queda con el último nombre

    const { rows } = await admin.query('SELECT count(*) FROM clientes WHERE tenant_id = $1', [
      local.tenantId,
    ]);
    expect(Number(rows[0].count)).toBe(1);
  });

  it('un grupo grande ocupa la mesa más tiempo', async () => {
    const resultado = await reservar({ personas: 8 });
    expect(resultado).toMatchObject({ tipo: 'creada', duracionMin: 120 });
  });

  it('usa las cabeceras antes que unir mesas', async () => {
    // Con la mesa de 6 ocupada, un grupo de 6 va a la de 4 con dos sillas de punta.
    await reservar({ personas: 6 });
    const segunda = await reservar({ personas: 6, contacto: { nombre: 'Beto', telefono: '1155551111' } });
    expect(segunda).toMatchObject({ tipo: 'creada', cabecerasUsadas: 2 });
    if (segunda.tipo === 'creada') expect(segunda.mesas.map((m) => m.nombre)).toEqual(['4']);
  });

  it('respeta el horario de servicio del local', async () => {
    expect(await reservar({ inicio: cena('18:00') })).toEqual({ tipo: 'fuera_de_servicio' });
    expect(await reservar({ inicio: new Date('2026-10-11T01:30:00-03:00') })).toMatchObject({
      tipo: 'despues_del_ultimo_ingreso',
      franjaNombre: 'Cena',
    });
  });

  it('no deja reservar sin ningún dato de contacto', async () => {
    // No es un error técnico: es una reserva que nadie podría avisar.
    expect(await reservar({ contacto: { nombre: 'Anónimo' } })).toEqual({ tipo: 'sin_contacto' });
  });

  it('ofrece horarios cercanos cuando el salón está lleno', async () => {
    const llenar = Array.from({ length: 10 }, (_, i) =>
      reservar({ personas: 2, contacto: { nombre: `C${i}`, telefono: `115555${1000 + i}` } }),
    );
    await Promise.all(llenar);

    const tarde = await reservar({ contacto: { nombre: 'Zoe', telefono: '1155559999' } });
    expect(tarde.tipo).toBe('sin_lugar');
    if (tarde.tipo === 'sin_lugar') {
      expect(tarde.alternativas.length).toBeGreaterThan(0);
    }
  });

  it('guarda la explicación de la decisión, se haya asignado o no', async () => {
    const creada = await reservar();
    if (creada.tipo !== 'creada') throw new Error('no asignó');

    const { rows } = await admin.query(
      `SELECT version_algoritmo, explicacion FROM asignaciones_log WHERE reserva_id = $1`,
      [creada.reservaId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].version_algoritmo).toBe('1.0.0');
    expect(rows[0].explicacion.elegido).toBeTruthy();
    expect(rows[0].explicacion.evaluados.length).toBeGreaterThan(1);
  });

  it('deja el rastro de quién creó la reserva y por qué canal', async () => {
    const creada = await reservar({ canalOrigen: 'whatsapp' });
    if (creada.tipo !== 'creada') throw new Error('no asignó');

    const { rows } = await admin.query(
      `SELECT tipo, actor_tipo, datos FROM reservas_eventos WHERE reserva_id = $1 ORDER BY id`,
      [creada.reservaId],
    );
    expect(rows.map((f) => f.tipo)).toEqual(['creada', 'asignada_auto']);
    expect(rows[0].datos).toMatchObject({ canalOrigen: 'whatsapp', clienteNuevo: true });
  });
});

describe('walk-in', () => {
  it('ocupa la mesa y el motor deja de ofrecerla', async () => {
    const ocupado = await ocuparMesa(app, {
      tenantId: local.tenantId,
      mesaIds: [local.mesas['1']!],
      personas: 2,
      inicio: cena(),
      actor: STAFF,
    });
    expect(ocupado.tipo).toBe('ocupada');

    const resultado = await reservar();
    if (resultado.tipo !== 'creada') throw new Error('no asignó');
    expect(resultado.mesas.map((m) => m.nombre)).not.toContain('1');
  });

  it('avisa si la mesa ya estaba ocupada en vez de romper', async () => {
    const primero = { tenantId: local.tenantId, mesaIds: [local.mesas['5']!], personas: 4, inicio: cena(), actor: STAFF };
    expect((await ocuparMesa(app, primero)).tipo).toBe('ocupada');
    expect((await ocuparMesa(app, primero)).tipo).toBe('mesa_no_disponible');
  });
});

describe('reasignación manual', () => {
  it('mueve la reserva, la fija y registra quién la movió', async () => {
    const creada = await reservar();
    if (creada.tipo !== 'creada') throw new Error('no asignó');

    const resultado = await reasignarMesa(app, {
      tenantId: local.tenantId,
      reservaId: creada.reservaId,
      mesaIds: [local.mesas['5']!],
      motivo: 'lo pidió el cliente',
      actor: STAFF,
    });
    expect(resultado).toMatchObject({ tipo: 'reasignada', antes: ['1'], despues: ['5'] });

    // Fijada a mano: el re-optimizador automático no la toca (D2).
    const { rows } = await admin.query(
      `SELECT fijada_manualmente FROM reservas_mesas WHERE reserva_id = $1`,
      [creada.reservaId],
    );
    expect(rows[0].fijada_manualmente).toBe(true);

    const evento = await admin.query(
      `SELECT datos FROM reservas_eventos WHERE reserva_id = $1 AND tipo = 'reasignada_manual'`,
      [creada.reservaId],
    );
    expect(evento.rows[0].datos).toMatchObject({
      antes: ['1'],
      despues: ['5'],
      motivo: 'lo pidió el cliente',
    });
  });

  it('avisa del conflicto en vez de pisar otra reserva', async () => {
    const primera = await reservar();
    const segunda = await reservar({
      personas: 6,
      contacto: { nombre: 'Beto', telefono: '1155552222' },
    });
    if (primera.tipo !== 'creada' || segunda.tipo !== 'creada') throw new Error('no asignó');

    const resultado = await reasignarMesa(app, {
      tenantId: local.tenantId,
      reservaId: primera.reservaId,
      mesaIds: [local.mesas['5']!], // la que tiene la segunda reserva
      actor: STAFF,
    });
    expect(resultado).toEqual({ tipo: 'mesa_ocupada' });

    // La reserva original quedó intacta.
    const { rows } = await admin.query(
      `SELECT count(*) FROM reservas_mesas WHERE reserva_id = $1`,
      [primera.reservaId],
    );
    expect(Number(rows[0].count)).toBe(1);
  });
});

describe('estados y historial del cliente', () => {
  it('cancelar libera la mesa para otro', async () => {
    const creada = await reservar();
    if (creada.tipo !== 'creada') throw new Error('no asignó');

    await cambiarEstado(app, {
      tenantId: local.tenantId,
      reservaId: creada.reservaId,
      estado: 'cancelada',
      actor: STAFF,
    });

    const otra = await reservar({ contacto: { nombre: 'Beto', telefono: '1155553333' } });
    if (otra.tipo !== 'creada') throw new Error('no asignó');
    expect(otra.mesas.map((m) => m.nombre)).toEqual(['1']);
  });

  it('cuenta visitas, ausencias y cancelaciones por local', async () => {
    const primera = await reservar();
    if (primera.tipo !== 'creada') throw new Error('no asignó');
    await cambiarEstado(app, {
      tenantId: local.tenantId, reservaId: primera.reservaId, estado: 'sentada', actor: STAFF,
    });

    const segunda = await reservar({ inicio: cena('23:00') });
    if (segunda.tipo !== 'creada') throw new Error('no asignó');
    await cambiarEstado(app, {
      tenantId: local.tenantId, reservaId: segunda.reservaId, estado: 'no_show', actor: STAFF,
    });

    const { rows } = await admin.query(
      `SELECT visitas, no_shows, ultima_visita_en FROM clientes WHERE id = $1`,
      [primera.cliente.id],
    );
    expect(rows[0]).toMatchObject({ visitas: 1, no_shows: 1 });
    expect(rows[0].ultima_visita_en).not.toBeNull();
  });

  it('finalizar antes devuelve los minutos que sobraron al inventario', async () => {
    // La mesa queda libre para el resto del turno, pero no se borra que estuvo ocupada.
    const creada = await reservar({ inicio: new Date(Date.now() - 30 * 60_000) });
    if (creada.tipo !== 'creada') throw new Error('no asignó');

    const antes = await admin.query(
      `SELECT upper(periodo) AS hasta FROM reservas_mesas WHERE reserva_id = $1`,
      [creada.reservaId],
    );
    await cambiarEstado(app, {
      tenantId: local.tenantId, reservaId: creada.reservaId, estado: 'finalizada', actor: STAFF,
    });
    const despues = await admin.query(
      `SELECT upper(periodo) AS hasta FROM reservas_mesas WHERE reserva_id = $1`,
      [creada.reservaId],
    );

    expect(despues.rows[0].hasta.getTime()).toBeLessThan(antes.rows[0].hasta.getTime());
    const { rows } = await admin.query(`SELECT estado FROM reservas WHERE id = $1`, [
      creada.reservaId,
    ]);
    expect(rows[0].estado).toBe('finalizada');
  });
});

describe('carrera entre canales', () => {
  it('doce pedidos simultáneos no pisan una sola mesa', async () => {
    const pedidos = Array.from({ length: 12 }, (_, i) =>
      reservar({
        canalOrigen: i % 2 === 0 ? 'web' : 'whatsapp',
        contacto: { nombre: `C${i}`, telefono: `11555${String(40000 + i)}` },
      }),
    );
    const resultados = await Promise.all(pedidos);

    const asignadas = resultados.filter((r) => r.tipo === 'creada');
    const mesas = asignadas.flatMap((r) => (r.tipo === 'creada' ? r.mesas.map((m) => m.id) : []));

    // El salón tiene 10 mesas: entran 10 y las otras dos se van a horarios alternativos.
    expect(asignadas).toHaveLength(10);
    expect(new Set(mesas).size).toBe(mesas.length);
    expect(resultados.filter((r) => r.tipo === 'sin_lugar')).toHaveLength(2);
  });
});
