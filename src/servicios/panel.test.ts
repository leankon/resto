import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { URL_ADMIN, pool } from '../datos/conexion';
import { SALON_DEMO, crearLocal, type LocalCreado } from '../datos/semilla';
import { estadoDelSalon, historial, ingresosPorBloque, reservasDelDia } from './panel';
import { crearReserva, ocuparMesa, reasignarMesa } from './reservas';

const admin = new pg.Pool({ connectionString: URL_ADMIN });
const app = pool();
const STAFF = { tipo: 'staff' as const, id: null };
let local: LocalCreado;

const cena = (hora: string) => new Date(`2026-10-10T${hora}:00-03:00`);

beforeAll(async () => {
  local = await crearLocal(admin, {
    slug: `panel-${Date.now()}`, nombre: 'Bar Panel', salones: SALON_DEMO,
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

const reservar = (hora: string, personas = 2, nombre = 'Ana', telefono = '1123456789') =>
  crearReserva(app, {
    tenantId: local.tenantId,
    inicio: cena(hora),
    personas,
    canalOrigen: 'manual',
    actor: STAFF,
    contacto: { nombre, telefono },
  });

describe('reservasDelDia', () => {
  it('trae las reservas del día con su mesa y su cliente', async () => {
    await reservar('21:00');
    const dia = await reservasDelDia(app, local.tenantId, '2026-10-10');

    expect(dia).toHaveLength(1);
    expect(dia[0]).toMatchObject({ personas: 2, estado: 'confirmada', canalOrigen: 'manual' });
    expect(dia[0]!.mesas).toHaveLength(1);
    expect(dia[0]!.cliente).toMatchObject({ nombre: 'Ana', visitas: 0 });
    expect(dia[0]!.salon).toBe('Planta baja');
  });

  it('la reserva de la madrugada cae en la planilla de la noche anterior', async () => {
    // El bar cierra a las 02:00. El mozo que a las 00:30 sigue laburando está
    // trabajando el sábado, y su planilla tiene que decir lo mismo. Si esta reserva
    // apareciera en la del domingo, el sábado a la noche no la ve nadie.
    await crearReserva(app, {
      tenantId: local.tenantId,
      inicio: new Date('2026-10-11T00:30:00-03:00'),
      personas: 2, canalOrigen: 'manual', actor: STAFF,
      contacto: { nombre: 'Trasnochador', telefono: '1155551234' },
    });

    const delDiez = await reservasDelDia(app, local.tenantId, '2026-10-10');
    expect(delDiez).toHaveLength(1);
    expect(delDiez[0]!.cliente?.nombre).toBe('Trasnochador');
    expect(await reservasDelDia(app, local.tenantId, '2026-10-11')).toHaveLength(0);
  });

  it('pasado el cierre, la madrugada ya es del día nuevo', async () => {
    // A las 03:00 el local está cerrado hace una hora. Va como walk-in porque una
    // reserva a esa hora el motor no la toma, justamente por estar cerrado.
    await ocuparMesa(app, {
      tenantId: local.tenantId, mesaIds: [local.mesas['1']!], personas: 2,
      inicio: new Date('2026-10-11T03:00:00-03:00'), actor: STAFF,
    });

    expect(await reservasDelDia(app, local.tenantId, '2026-10-10')).toHaveLength(0);
    expect(await reservasDelDia(app, local.tenantId, '2026-10-11')).toHaveLength(1);
  });

  it('el corte es en hora local, no en UTC', async () => {
    // En UTC, una reserva de las 22:00 de Buenos Aires ya cae al día siguiente: sin
    // esta cuenta, la planilla del sábado aparecería vacía.
    await reservar('22:00');
    expect(await reservasDelDia(app, local.tenantId, '2026-10-10')).toHaveLength(1);
  });

  it('ordena por horario', async () => {
    await reservar('22:00', 2, 'Tarde', '1155550001');
    await reservar('20:30', 2, 'Temprano', '1155550002');
    const dia = await reservasDelDia(app, local.tenantId, '2026-10-10');
    expect(dia.map((r) => r.cliente?.nombre)).toEqual(['Temprano', 'Tarde']);
  });

  it('un walk-in aparece en la planilla sin cliente', async () => {
    await ocuparMesa(app, {
      tenantId: local.tenantId, mesaIds: [local.mesas['1']!], personas: 3,
      inicio: cena('21:00'), actor: STAFF,
    });
    const dia = await reservasDelDia(app, local.tenantId, '2026-10-10');
    expect(dia[0]).toMatchObject({ canalOrigen: 'walk_in', cliente: null, personas: 3 });
  });
});

describe('ingresosPorBloque', () => {
  it('agrupa la gente que entra en bloques de 15 minutos', async () => {
    await reservar('21:00', 2, 'A', '1155550011');
    await reservar('21:10', 4, 'B', '1155550012');
    await reservar('21:30', 6, 'C', '1155550013');

    const bloques = await ingresosPorBloque(app, local.tenantId, '2026-10-10');
    expect(bloques).toEqual([
      { hora: '21:00', personas: 6, reservas: 2 },
      { hora: '21:30', personas: 6, reservas: 1 },
    ]);
  });

  it('no cuenta las canceladas ni las ausencias', async () => {
    const creada = await reservar('21:00');
    if (creada.tipo !== 'creada') throw new Error('no asignó');
    await admin.query(`UPDATE reservas SET estado = 'cancelada' WHERE id = $1`, [creada.reservaId]);

    expect(await ingresosPorBloque(app, local.tenantId, '2026-10-10')).toEqual([]);
  });
});

describe('estadoDelSalon', () => {
  it('devuelve un salón por piso, con las mesas ocupadas marcadas', async () => {
    await reservar('21:00');
    const salones = await estadoDelSalon(app, local.tenantId, cena('21:30'));

    expect(salones.map((s) => s.nombre)).toEqual(['Planta baja', 'Terraza']);
    const ocupadas = salones.flatMap((s) => s.mesas.filter((m) => m.ocupadaPor));
    expect(ocupadas).toHaveLength(1);
    expect(ocupadas[0]!.ocupadaPor).toMatchObject({ cliente: 'Ana', personas: 2 });
  });

  it('a una hora sin reservas el salón está entero libre', async () => {
    await reservar('21:00');
    const salones = await estadoDelSalon(app, local.tenantId, cena('12:30'));
    expect(salones.flatMap((s) => s.mesas).every((m) => !m.ocupadaPor)).toBe(true);
  });

  it('trae el turno entero de cada mesa, no solo el instante que se mira', async () => {
    // Dos reservas seguidas en mesas distintas: a las 20:30 la segunda mesa está
    // libre, pero la toman a las 21:15. El plano necesita saberlo para no ofrecerla
    // como destino de una reserva que todavía no terminó.
    const temprano = await reservar('20:30');
    const tarde = await reservar('21:15', 2, 'Bruno', '1155556666');
    if (temprano.tipo !== 'creada' || tarde.tipo !== 'creada') throw new Error('no asignó');

    const salones = await estadoDelSalon(app, local.tenantId, cena('20:30'));
    const mesas = salones.flatMap((s) => s.mesas);

    const deLaTarde = mesas.find((m) => m.nombre === tarde.mesas[0]!.nombre)!;
    expect(deLaTarde.ocupadaPor).toBeNull();
    expect(deLaTarde.ocupaciones).toHaveLength(1);
    expect(deLaTarde.ocupaciones[0]!.reservaId).toBe(tarde.reservaId);

    // Y las que nadie tiene en todo el turno vienen sin nada.
    const libres = mesas.filter((m) => m.ocupaciones.length === 0);
    expect(libres.length).toBeGreaterThan(0);
  });

  it('cada mesa sabe con qué otras comparte la reserva', async () => {
    // Una reserva armada con dos mesas unidas. Sin esto el plano la muestra como dos
    // ocupaciones sueltas, y mover una sola dejaría la reserva partida a la mitad.
    const grupo = await reservar('21:00', 6, 'Grupo', '1177778888');
    if (grupo.tipo !== 'creada') throw new Error('no asignó');
    await reasignarMesa(app, {
      tenantId: local.tenantId,
      reservaId: grupo.reservaId,
      mesaIds: [local.mesas['6']!, local.mesas['7']!],
      actor: STAFF,
    });

    const salones = await estadoDelSalon(app, local.tenantId, cena('21:30'));
    const ocupadas = salones.flatMap((s) => s.mesas).filter((m) => m.ocupadaPor);

    expect(ocupadas.map((m) => m.nombre).sort()).toEqual(['6', '7']);
    for (const mesa of ocupadas) {
      expect([mesa.nombre, ...mesa.ocupadaPor!.conMesas].sort()).toEqual(['6', '7']);
    }
  });
});

describe('la mesa se libera cuando termina el turno', () => {
  it('con turnos de dos horas, el de las 21:00 deja la mesa libre a las 23:00', async () => {
    // Es el caso que importa: si la limpieza se sumara al turno, a las 23:00 la mesa
    // seguiría figurando ocupada y el local dejaría de vender ese horario.
    await admin.query(
      `UPDATE duraciones_turno SET duracion_min = 120, buffer_min = 0 WHERE tenant_id = $1`,
      [local.tenantId],
    );
    const creada = await reservar('21:00');
    if (creada.tipo !== 'creada') throw new Error('no asignó');
    expect(creada.duracionMin).toBe(120);

    const mesa = creada.mesas[0]!.nombre;
    const alas2259 = await estadoDelSalon(app, local.tenantId, cena('22:59'));
    const alas2300 = await estadoDelSalon(app, local.tenantId, cena('23:00'));

    const buscar = (salones: Awaited<ReturnType<typeof estadoDelSalon>>) =>
      salones.flatMap((s) => s.mesas).find((m) => m.nombre === mesa)!;

    expect(buscar(alas2259).ocupadaPor).not.toBeNull();
    expect(buscar(alas2300).ocupadaPor).toBeNull();
  });

  it('y a las 23:00 se puede sentar a otro en esa misma mesa', async () => {
    await admin.query(
      `UPDATE duraciones_turno SET duracion_min = 120, buffer_min = 0 WHERE tenant_id = $1`,
      [local.tenantId],
    );
    const primera = await reservar('21:00');
    if (primera.tipo !== 'creada') throw new Error('no asignó');

    const segunda = await crearReserva(app, {
      tenantId: local.tenantId,
      inicio: cena('23:00'),
      personas: 2, canalOrigen: 'manual', actor: STAFF,
      contacto: { nombre: 'El de las once', telefono: '1155557777' },
    });
    if (segunda.tipo !== 'creada') throw new Error('no entró el segundo turno');

    // La misma mesa, pegadita: es exactamente lo que el local quiere vender.
    expect(segunda.mesas[0]!.nombre).toBe(primera.mesas[0]!.nombre);
  });
});

describe('historial', () => {
  it('cuenta quién movió la reserva y de dónde a dónde', async () => {
    const creada = await reservar('21:00');
    if (creada.tipo !== 'creada') throw new Error('no asignó');

    await reasignarMesa(app, {
      tenantId: local.tenantId, reservaId: creada.reservaId,
      mesaIds: [local.mesas['5']!], motivo: 'pidió ventana', actor: STAFF,
    });

    const eventos = await historial(app, local.tenantId, creada.reservaId);
    expect(eventos.map((e) => e.tipo)).toEqual(['creada', 'asignada_auto', 'reasignada_manual']);
    expect(eventos[2]!.datos).toMatchObject({ despues: ['5'], motivo: 'pidió ventana' });
  });
});
