import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { URL_ADMIN, URL_AUTH } from '../datos/conexion';
import { crearLocal } from '../datos/semilla';
import { crearUsuarioStaff } from './administracion';
import { login, sesionActual } from './auth';
import {
  agregarAlEquipo, cambiarPassword, cambiarRol, listarEquipo, quitarDelEquipo,
} from './equipo';

const admin = new pg.Pool({ connectionString: URL_ADMIN });
const auth = new pg.Pool({ connectionString: URL_AUTH });
const sufijo = Date.now();
let barA: string;
let barB: string;
let duenioId: string;

const mail = (quien: string) => `${quien}-${sufijo}@bar.test`;

beforeAll(async () => {
  barA = (await crearLocal(admin, { slug: `eqa-${sufijo}`, nombre: 'Bar A', salones: [] })).tenantId;
  barB = (await crearLocal(admin, { slug: `eqb-${sufijo}`, nombre: 'Bar B', salones: [] })).tenantId;
});

beforeEach(async () => {
  await admin.query(
    `DELETE FROM usuarios WHERE email LIKE $1`, [`%-${sufijo}@bar.test`],
  );
  const r = await crearUsuarioStaff(admin, {
    email: mail('duenio'), nombre: 'Dueña', password: 'clave-larga-123',
    tenantId: barA, rol: 'dueño',
  });
  duenioId = r.usuarioId;
});

afterAll(async () => {
  await admin.query(`DELETE FROM usuarios WHERE email LIKE $1`, [`%-${sufijo}@bar.test`]);
  await admin.query('DELETE FROM tenants WHERE id = ANY($1)', [[barA, barB]]);
  await Promise.all([admin.end(), auth.end()]);
});

describe('dar de alta gente', () => {
  it('agrega un mozo y queda listado con su rol', async () => {
    expect(await agregarAlEquipo(admin, barA, {
      email: mail('mozo'), nombre: 'Mozo', password: 'clave-larga-123', rol: 'mozo',
    })).toEqual({ tipo: 'ok' });

    const equipo = await listarEquipo(admin, barA);
    expect(equipo.map((m) => [m.nombre, m.rol])).toEqual([['Dueña', 'dueño'], ['Mozo', 'mozo']]);
  });

  it('el mozo nuevo puede entrar al panel', async () => {
    await agregarAlEquipo(admin, barA, {
      email: mail('mozo'), nombre: 'Mozo', password: 'clave-larga-123', rol: 'mozo',
    });
    const entrada = await login(auth, { email: mail('mozo'), password: 'clave-larga-123' });
    expect(entrada).toMatchObject({ tipo: 'ok', tenantId: barA });
    if (entrada.tipo === 'ok') {
      expect(await sesionActual(auth, entrada.token)).toMatchObject({ rol: 'mozo' });
    }
  });

  it('rechaza mail inválido, nombre vacío y contraseña corta', async () => {
    const base = { email: mail('x'), nombre: 'X', password: 'clave-larga-123', rol: 'mozo' as const };
    const casos: [Partial<typeof base>, RegExp][] = [
      [{ email: 'no-es-mail' }, /mail/i],
      [{ nombre: '  ' }, /nombre/i],
      [{ password: 'corta' }, /contraseña/i],
    ];
    for (const [cambio, esperado] of casos) {
      const r = await agregarAlEquipo(admin, barA, { ...base, ...cambio });
      expect(r.tipo).toBe('invalido');
      if (r.tipo === 'invalido') expect(r.motivo).toMatch(esperado);
    }
  });

  it('avisa si esa persona ya está en el local', async () => {
    const datos = {
      email: mail('mozo'), nombre: 'Mozo', password: 'clave-larga-123', rol: 'mozo' as const,
    };
    await agregarAlEquipo(admin, barA, datos);
    expect(await agregarAlEquipo(admin, barA, datos)).toEqual({ tipo: 'ya_esta' });
  });

  it('la misma persona puede trabajar en dos locales con una sola cuenta', async () => {
    const datos = {
      email: mail('mozo'), nombre: 'Mozo', password: 'clave-larga-123', rol: 'mozo' as const,
    };
    await agregarAlEquipo(admin, barA, datos);
    // En el segundo local se la agrega con otra contraseña: no tiene que pisar la suya.
    expect(await agregarAlEquipo(admin, barB, { ...datos, password: 'otra-clave-larga' }))
      .toEqual({ tipo: 'ok' });

    const entrada = await login(auth, { email: mail('mozo'), password: 'clave-larga-123' });
    expect(entrada).toMatchObject({ tipo: 'ok', tenantId: null }); // tiene que elegir local
    if (entrada.tipo === 'ok') expect(entrada.locales).toHaveLength(2);

    expect((await listarEquipo(admin, barA)).find((m) => m.nombre === 'Mozo')?.enOtrosLocales)
      .toBe(true);
  });
});

describe('cambiar permisos y sacar gente', () => {
  it('cambia el rol', async () => {
    await agregarAlEquipo(admin, barA, {
      email: mail('mozo'), nombre: 'Mozo', password: 'clave-larga-123', rol: 'mozo',
    });
    const equipo = await listarEquipo(admin, barA);
    const mozo = equipo.find((m) => m.nombre === 'Mozo')!;

    expect(await cambiarRol(admin, barA, mozo.usuarioId, 'encargado')).toEqual({ tipo: 'ok' });
    expect((await listarEquipo(admin, barA)).find((m) => m.nombre === 'Mozo')?.rol)
      .toBe('encargado');
  });

  it('no deja quedarse sin ningún dueño', async () => {
    // Sin dueño nadie puede volver a tocar la configuración del local.
    expect(await cambiarRol(admin, barA, duenioId, 'mozo')).toEqual({ tipo: 'ultimo_duenio' });
    expect(await quitarDelEquipo(admin, barA, duenioId, 'otro')).toEqual({ tipo: 'ultimo_duenio' });
  });

  it('con dos dueños sí se puede bajar a uno de rol', async () => {
    await agregarAlEquipo(admin, barA, {
      email: mail('socio'), nombre: 'Socio', password: 'clave-larga-123', rol: 'dueño',
    });
    expect(await cambiarRol(admin, barA, duenioId, 'encargado')).toEqual({ tipo: 'ok' });
  });

  it('nadie se saca a sí mismo', async () => {
    await agregarAlEquipo(admin, barA, {
      email: mail('socio'), nombre: 'Socio', password: 'clave-larga-123', rol: 'dueño',
    });
    expect(await quitarDelEquipo(admin, barA, duenioId, duenioId)).toEqual({ tipo: 'sos_vos' });
  });

  it('sacar a alguien le corta la sesión abierta en ese local', async () => {
    // Al que echaron hoy le queda el navegador abierto en la tablet del salón.
    await agregarAlEquipo(admin, barA, {
      email: mail('mozo'), nombre: 'Mozo', password: 'clave-larga-123', rol: 'mozo',
    });
    const entrada = await login(auth, { email: mail('mozo'), password: 'clave-larga-123' });
    if (entrada.tipo !== 'ok') throw new Error('no entró');
    expect(await sesionActual(auth, entrada.token)).not.toBeNull();

    const mozo = (await listarEquipo(admin, barA)).find((m) => m.nombre === 'Mozo')!;
    await quitarDelEquipo(admin, barA, mozo.usuarioId, duenioId);
    expect(await sesionActual(auth, entrada.token)).toBeNull();
  });

  it('sacar a alguien no borra su cuenta si trabaja en otro local', async () => {
    const datos = {
      email: mail('mozo'), nombre: 'Mozo', password: 'clave-larga-123', rol: 'mozo' as const,
    };
    await agregarAlEquipo(admin, barA, datos);
    await agregarAlEquipo(admin, barB, datos);

    const mozo = (await listarEquipo(admin, barA)).find((m) => m.nombre === 'Mozo')!;
    await quitarDelEquipo(admin, barA, mozo.usuarioId, duenioId);

    expect(await listarEquipo(admin, barB)).toHaveLength(1);
    expect(await login(auth, { email: mail('mozo'), password: 'clave-larga-123' }))
      .toMatchObject({ tipo: 'ok', tenantId: barB });
  });
});

describe('cambiar la contraseña de alguien', () => {
  it('le pone una nueva y le corta las sesiones', async () => {
    await agregarAlEquipo(admin, barA, {
      email: mail('mozo'), nombre: 'Mozo', password: 'clave-larga-123', rol: 'mozo',
    });
    const entrada = await login(auth, { email: mail('mozo'), password: 'clave-larga-123' });
    if (entrada.tipo !== 'ok') throw new Error('no entró');

    const mozo = (await listarEquipo(admin, barA)).find((m) => m.nombre === 'Mozo')!;
    expect(await cambiarPassword(admin, barA, mozo.usuarioId, 'clave-nueva-456'))
      .toEqual({ tipo: 'ok' });

    expect(await sesionActual(auth, entrada.token)).toBeNull();
    expect(await login(auth, { email: mail('mozo'), password: 'clave-larga-123' }))
      .toEqual({ tipo: 'credenciales_invalidas' });
    expect(await login(auth, { email: mail('mozo'), password: 'clave-nueva-456' }))
      .toMatchObject({ tipo: 'ok' });
  });

  it('no deja cambiarle la contraseña a alguien de otro local', async () => {
    // El id se podría pasar a mano; lo que lo impide es la pertenencia al local.
    await agregarAlEquipo(admin, barB, {
      email: mail('ajeno'), nombre: 'Ajeno', password: 'clave-larga-123', rol: 'mozo',
    });
    const ajeno = (await listarEquipo(admin, barB)).find((m) => m.nombre === 'Ajeno')!;

    const r = await cambiarPassword(admin, barA, ajeno.usuarioId, 'clave-nueva-456');
    expect(r.tipo).toBe('invalido');
    expect(await login(auth, { email: mail('ajeno'), password: 'clave-larga-123' }))
      .toMatchObject({ tipo: 'ok' });
  });
});
