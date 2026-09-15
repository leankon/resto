import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { URL_ADMIN, URL_AUTH } from '../datos/conexion.js';
import { crearLocal } from '../datos/semilla.js';
import { crearUsuarioStaff } from './administracion.js';
import {
  cerrarSesion,
  elegirLocal,
  limpiarSesionesVencidas,
  login,
  sesionActual,
} from './auth.js';

const admin = new pg.Pool({ connectionString: URL_ADMIN });
const auth = new pg.Pool({ connectionString: URL_AUTH });

const sufijo = Date.now();
const email = `encargado-${sufijo}@bar.com`;
const emailDosLocales = `duenio-${sufijo}@bar.com`;
let barA: string;
let barB: string;

beforeAll(async () => {
  barA = (await crearLocal(admin, { slug: `a-${sufijo}`, nombre: 'Bar A', salones: [] })).tenantId;
  barB = (await crearLocal(admin, { slug: `b-${sufijo}`, nombre: 'Bar B', salones: [] })).tenantId;

  await crearUsuarioStaff(admin, {
    email, nombre: 'Encargado', password: 'clave-larga-123', tenantId: barA, rol: 'encargado',
  });
  await crearUsuarioStaff(admin, {
    email: emailDosLocales, nombre: 'Dueño', password: 'clave-larga-123', tenantId: barA, rol: 'dueño',
  });
  await crearUsuarioStaff(admin, {
    email: emailDosLocales, nombre: 'Dueño', password: 'clave-larga-123', tenantId: barB, rol: 'dueño',
  });
});

afterAll(async () => {
  await admin.query(`DELETE FROM usuarios WHERE email IN ($1, $2)`, [email, emailDosLocales]);
  await admin.query('DELETE FROM tenants WHERE id = ANY($1)', [[barA, barB]]);
  await Promise.all([admin.end(), auth.end()]);
});

describe('login', () => {
  it('deja entrar con la contraseña correcta y activa el único local', async () => {
    const resultado = await login(auth, { email, password: 'clave-larga-123' });
    expect(resultado).toMatchObject({ tipo: 'ok', tenantId: barA });
    if (resultado.tipo !== 'ok') throw new Error('no entró');
    expect(resultado.locales).toHaveLength(1);

    const sesion = await sesionActual(auth, resultado.token);
    expect(sesion).toMatchObject({ tipo: 'staff', tenantId: barA, rol: 'encargado' });
  });

  it('rechaza contraseña incorrecta y mail inexistente igual de rápido', async () => {
    const medir = async (entrada: { email: string; password: string }) => {
      const arranque = process.hrtime.bigint();
      const resultado = await login(auth, entrada);
      return { resultado, ms: Number(process.hrtime.bigint() - arranque) / 1e6 };
    };
    const mala = await medir({ email, password: 'clave-equivocada' });
    const inexistente = await medir({ email: `nadie-${sufijo}@bar.com`, password: 'x' });

    expect(mala.resultado).toEqual({ tipo: 'credenciales_invalidas' });
    expect(inexistente.resultado).toEqual({ tipo: 'credenciales_invalidas' });
    // Si el mail inexistente respondiera mucho más rápido, serviría para averiguar
    // qué direcciones están registradas.
    const proporcion = inexistente.ms / mala.ms;
    expect(proporcion).toBeGreaterThan(0.3);
    expect(proporcion).toBeLessThan(3);
  });

  it('un usuario con dos locales elige cuál abrir', async () => {
    const resultado = await login(auth, { email: emailDosLocales, password: 'clave-larga-123' });
    if (resultado.tipo !== 'ok') throw new Error('no entró');

    expect(resultado.locales).toHaveLength(2);
    expect(resultado.tenantId).toBeNull(); // no adivina por cuál empezar

    expect(await elegirLocal(auth, resultado.token, barB)).toBe(true);
    expect(await sesionActual(auth, resultado.token)).toMatchObject({ tenantId: barB });
  });

  it('no deja abrir un local en el que la persona no trabaja', async () => {
    const resultado = await login(auth, { email, password: 'clave-larga-123' });
    if (resultado.tipo !== 'ok') throw new Error('no entró');

    expect(await elegirLocal(auth, resultado.token, barB)).toBe(false);
    expect(await sesionActual(auth, resultado.token)).toMatchObject({ tenantId: barA });
  });

  it('no deja entrar a un usuario desactivado', async () => {
    await admin.query(`UPDATE usuarios SET activo = false WHERE email = $1`, [email]);
    expect(await login(auth, { email, password: 'clave-larga-123' })).toEqual({
      tipo: 'credenciales_invalidas',
    });
    await admin.query(`UPDATE usuarios SET activo = true WHERE email = $1`, [email]);
  });

  it('desactivar a alguien corta sus sesiones ya abiertas', async () => {
    // No alcanza con bloquear el próximo login: el que echaron hoy tiene el navegador abierto.
    const resultado = await login(auth, { email, password: 'clave-larga-123' });
    if (resultado.tipo !== 'ok') throw new Error('no entró');

    await admin.query(`UPDATE usuarios SET activo = false WHERE email = $1`, [email]);
    expect(await sesionActual(auth, resultado.token)).toBeNull();
    await admin.query(`UPDATE usuarios SET activo = true WHERE email = $1`, [email]);
  });
});

describe('sesiones', () => {
  it('un token inventado no sirve', async () => {
    expect(await sesionActual(auth, 'token-falso')).toBeNull();
    expect(await sesionActual(auth, undefined)).toBeNull();
  });

  it('cerrar sesión invalida el token', async () => {
    const resultado = await login(auth, { email, password: 'clave-larga-123' });
    if (resultado.tipo !== 'ok') throw new Error('no entró');

    await cerrarSesion(auth, resultado.token);
    expect(await sesionActual(auth, resultado.token)).toBeNull();
  });

  it('una sesión vencida no sirve, y el job la limpia', async () => {
    const resultado = await login(auth, { email, password: 'clave-larga-123' });
    if (resultado.tipo !== 'ok') throw new Error('no entró');

    await admin.query(`UPDATE sesiones SET expira_en = now() - interval '1 minute'
                        WHERE token_hash = encode(sha256($1::bytea), 'hex')`, [resultado.token]);
    expect(await sesionActual(auth, resultado.token)).toBeNull();
    expect(await limpiarSesionesVencidas(auth)).toBeGreaterThan(0);
  });

  it('guarda el hash del token, no el token', async () => {
    // Con una copia de la base robada no se puede entrar a ninguna cuenta.
    const resultado = await login(auth, { email, password: 'clave-larga-123' });
    if (resultado.tipo !== 'ok') throw new Error('no entró');

    const { rows } = await admin.query(
      `SELECT count(*) FROM sesiones WHERE token_hash = $1`, [resultado.token],
    );
    expect(Number(rows[0].count)).toBe(0);
  });
});

describe('alcance del rol de autenticación', () => {
  it('el rol del login no puede tocar reservas ni clientes', async () => {
    // Ignora RLS, así que lo que lo contiene son los permisos de tabla.
    await expect(auth.query('SELECT * FROM reservas')).rejects.toThrow(/permission denied/i);
    await expect(auth.query('SELECT * FROM clientes')).rejects.toThrow(/permission denied/i);
  });
});
