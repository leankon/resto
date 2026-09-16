import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hoyEn, instanteLocal, sumarDias, sumarMinutos } from '../dominio/tiempo';
import { URL_ADMIN, URL_AUTH, pool } from '../datos/conexion';
import { SALON_DEMO, crearLocal, type LocalCreado } from '../datos/semilla';
import {
  cancelarPorToken,
  disponibilidad,
  localPorSlug,
  reservarDesdeLaWeb,
  reservaPorToken,
  type LocalPublico,
} from './publico';

const admin = new pg.Pool({ connectionString: URL_ADMIN });
const auth = new pg.Pool({ connectionString: URL_AUTH });
const app = pool();

const TZ = 'America/Argentina/Buenos_Aires';
let creado: LocalCreado;
let local: LocalPublico;
let slug: string;

/** Un día futuro: las reglas de anticipación son relativas a hoy. */
const dia = () => sumarDias(hoyEn(TZ), 3);
const aLas = (hora: string) => instanteLocal(dia(), hora, TZ);

beforeAll(async () => {
  slug = `publico-${Date.now()}`;
  creado = await crearLocal(admin, { slug, nombre: 'Bar Público', salones: SALON_DEMO });
  await admin.query(
    `UPDATE tenants SET web_publica = true, direccion = 'Av. Siempreviva 742'
      WHERE id = $1`,
    [creado.tenantId],
  );
  local = (await localPorSlug(auth, slug))!;
});

beforeEach(async () => {
  await admin.query('DELETE FROM reservas WHERE tenant_id = $1', [creado.tenantId]);
  await admin.query('DELETE FROM clientes WHERE tenant_id = $1', [creado.tenantId]);
});

afterAll(async () => {
  await admin.query('DELETE FROM tenants WHERE id = $1', [creado.tenantId]);
  await admin.end();
  await auth.end();
  await app.end();
});

const contacto = { nombre: 'Ana', telefono: '011 15 2345-6789' };
const reservar = (extra: Partial<Parameters<typeof reservarDesdeLaWeb>[2]> = {}) =>
  reservarDesdeLaWeb(app, local, { inicio: aLas('21:00'), personas: 2, contacto, ...extra });

describe('localPorSlug', () => {
  it('encuentra el local por su dirección web con los datos de cara al público', async () => {
    expect(local).toMatchObject({
      slug,
      nombre: 'Bar Público',
      webPublica: true,
      direccion: 'Av. Siempreviva 742',
      personasMaxWeb: 10,
    });
  });

  it('no encuentra un local que no existe ni uno suspendido', async () => {
    expect(await localPorSlug(auth, 'no-existe')).toBeNull();

    await admin.query(`UPDATE tenants SET estado = 'suspendido' WHERE id = $1`, [
      creado.tenantId,
    ]);
    expect(await localPorSlug(auth, slug)).toBeNull();
    await admin.query(`UPDATE tenants SET estado = 'activo' WHERE id = $1`, [creado.tenantId]);
  });
});

describe('disponibilidad', () => {
  it('ofrece la grilla del servicio con lugar en todos los horarios', async () => {
    const resultado = await disponibilidad(app, local, { fecha: dia(), personas: 2 });

    expect(resultado.motivo).toBeNull();
    expect(resultado.horarios.map((h) => h.hora)).toContain('21:00');
    expect(resultado.horarios.every((h) => h.hayLugar)).toBe(true);
  });

  it('marca sin lugar el horario que se llenó, y deja libres los demás', async () => {
    // El salón de demo tiene 10 mesas. Se llenan todas a las 21:00.
    for (let i = 0; i < 10; i++) {
      await reservar({ personas: 2, contacto: { nombre: `C${i}`, telefono: `1122${i}33444` } });
    }

    const resultado = await disponibilidad(app, local, { fecha: dia(), personas: 2 });
    const alas21 = resultado.horarios.find((h) => h.hora === '21:00');
    const alas13 = resultado.horarios.find((h) => h.hora === '13:00');

    expect(alas21!.hayLugar).toBe(false);
    expect(alas13!.hayLugar).toBe(true);
  });

  it('no ofrece horarios de un día en el que el local está cerrado', async () => {
    await admin.query(
      `INSERT INTO excepciones_calendario (tenant_id, fecha, cerrado, motivo)
       VALUES ($1, $2, true, 'Feriado')`,
      [creado.tenantId, dia()],
    );
    const resultado = await disponibilidad(app, local, { fecha: dia(), personas: 2 });

    expect(resultado.horarios).toEqual([]);
    expect(resultado.motivo).toBe('cerrado');
    await admin.query('DELETE FROM excepciones_calendario WHERE tenant_id = $1', [
      creado.tenantId,
    ]);
  });

  it('un día especial que abre antes se ofrece desde esa hora', async () => {
    // La cena del local arranca a las 20:00. Ese día abre a las 18:00, y la web tiene
    // que ofrecerlo: si no, el local anuncia un horario que su propia página no toma.
    await admin.query(
      `INSERT INTO excepciones_calendario (tenant_id, fecha, cerrado, desde, hasta, motivo)
       VALUES ($1, $2, false, '18:00', '23:00', 'Abrimos temprano')`,
      [creado.tenantId, dia()],
    );
    const resultado = await disponibilidad(app, local, { fecha: dia(), personas: 2 });
    const horas = resultado.horarios.map((h) => h.hora);

    expect(horas).toContain('18:00');
    expect(horas[0]).toBe('18:00');
    // Y reemplaza el horario habitual: el almuerzo de ese día no va más.
    expect(horas).not.toContain('13:00');
    expect(resultado.horarios[0]!.franjaNombre).toBe('Abrimos temprano');

    await admin.query('DELETE FROM excepciones_calendario WHERE tenant_id = $1', [
      creado.tenantId,
    ]);
  });

  it('no ofrece horarios que ya no llegan a la anticipación mínima', async () => {
    // Se pregunta por hoy, parados a las 20:59, con una hora de anticipación mínima.
    const casiLasNueve = instanteLocal(hoyEn(TZ), '20:59', TZ);
    const resultado = await disponibilidad(app, local, {
      fecha: hoyEn(TZ),
      personas: 2,
      ahora: casiLasNueve,
    });

    const horas = resultado.horarios.map((h) => h.hora);
    expect(horas).not.toContain('21:00');
    expect(horas).not.toContain('13:00');
    expect(horas).toContain('22:00');
  });
});

describe('reservarDesdeLaWeb', () => {
  it('crea la reserva y devuelve un token para volver a ella', async () => {
    const resultado = await reservar();
    expect(resultado.tipo).toBe('creada');
    if (resultado.tipo !== 'creada') throw new Error('no reservó');

    const vista = await reservaPorToken(app, local, resultado.token);
    expect(vista).toMatchObject({ personas: 2, estado: 'confirmada', nombre: 'Ana' });
  });

  it('guarda el hash del token, nunca el token', async () => {
    const resultado = await reservar();
    if (resultado.tipo !== 'creada') throw new Error('no reservó');

    const { rows } = await admin.query('SELECT token_hash FROM reservas WHERE id = $1', [
      resultado.reservaId,
    ]);
    expect(rows[0].token_hash).not.toBe(resultado.token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('queda registrada como reserva de la web, no de mostrador', async () => {
    const resultado = await reservar();
    if (resultado.tipo !== 'creada') throw new Error('no reservó');

    const { rows } = await admin.query('SELECT canal_origen FROM reservas WHERE id = $1', [
      resultado.reservaId,
    ]);
    expect(rows[0].canal_origen).toBe('web');
  });

  it('rechaza un grupo más grande del que el local acepta por la web', async () => {
    expect(await reservar({ personas: 11 })).toEqual({ tipo: 'grupo_muy_grande', maximo: 10 });
  });

  it('rechaza una reserva sobre la hora', async () => {
    const enDiezMinutos = sumarMinutos(new Date(), 10);
    expect(await reservar({ inicio: enDiezMinutos })).toMatchObject({
      tipo: 'muy_sobre_la_hora',
    });
  });

  it('rechaza una reserva más allá del plazo que abrió el local', async () => {
    const enUnAño = instanteLocal(sumarDias(hoyEn(TZ), 300), '21:00', TZ);
    expect(await reservar({ inicio: enUnAño })).toMatchObject({ tipo: 'fuera_de_plazo' });
  });

  it('no acepta nada si el local todavía no prendió su web', async () => {
    const apagada = { ...local, webPublica: false };
    const resultado = await reservarDesdeLaWeb(app, apagada, {
      inicio: aLas('21:00'),
      personas: 2,
      contacto,
    });
    expect(resultado).toEqual({ tipo: 'web_apagada' });
  });

  it('sin teléfono ni mail no hay reserva: no habría forma de avisarle nada', async () => {
    expect(await reservar({ contacto: { nombre: 'Fantasma' } })).toEqual({
      tipo: 'sin_contacto',
    });
  });
});

describe('cancelarPorToken', () => {
  it('cancela y suelta la mesa, que vuelve a estar disponible', async () => {
    // Un grupo de 12 necesita todo el salón: si la mesa no se libera de verdad, la
    // segunda reserva no entra.
    const primera = await reservar({ personas: 8 });
    if (primera.tipo !== 'creada') throw new Error('no reservó');

    expect(await cancelarPorToken(app, local, primera.token)).toEqual({ tipo: 'cancelada' });

    const { rows } = await admin.query(
      'SELECT count(*) FROM reservas_mesas WHERE reserva_id = $1',
      [primera.reservaId],
    );
    expect(Number(rows[0].count)).toBe(0);

    const despues = await disponibilidad(app, local, { fecha: dia(), personas: 8 });
    expect(despues.horarios.find((h) => h.hora === '21:00')!.hayLugar).toBe(true);
  });

  it('le suma la cancelación al historial del cliente', async () => {
    const reserva = await reservar();
    if (reserva.tipo !== 'creada') throw new Error('no reservó');
    await cancelarPorToken(app, local, reserva.token);

    const { rows } = await admin.query(
      'SELECT cancelaciones FROM clientes WHERE tenant_id = $1',
      [creado.tenantId],
    );
    expect(rows[0].cancelaciones).toBe(1);
  });

  it('un token que no existe no cancela nada', async () => {
    expect(await cancelarPorToken(app, local, 'token-inventado')).toEqual({ tipo: 'no_existe' });
  });

  it('no deja cancelar cuando ya pasó el plazo, para que lo resuelva el local', async () => {
    const reserva = await reservar();
    if (reserva.tipo !== 'creada') throw new Error('no reservó');

    // Parados una hora antes, con un plazo de cancelación de dos horas.
    const unaHoraAntes = sumarMinutos(aLas('21:00'), -60);
    expect(await cancelarPorToken(app, local, reserva.token, unaHoraAntes)).toMatchObject({
      tipo: 'ya_no_se_puede',
    });

    const vista = await reservaPorToken(app, local, reserva.token, unaHoraAntes);
    expect(vista!.sePuedeCancelar).toBe(false);
    expect(vista!.estado).toBe('confirmada');
  });

  it('cancelar dos veces no rompe ni descuenta dos veces', async () => {
    const reserva = await reservar();
    if (reserva.tipo !== 'creada') throw new Error('no reservó');

    await cancelarPorToken(app, local, reserva.token);
    expect(await cancelarPorToken(app, local, reserva.token)).toEqual({
      tipo: 'ya_estaba_cancelada',
    });

    const { rows } = await admin.query(
      'SELECT cancelaciones FROM clientes WHERE tenant_id = $1',
      [creado.tenantId],
    );
    expect(rows[0].cancelaciones).toBe(1);
  });
});
