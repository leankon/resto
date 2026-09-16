import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { URL_ADMIN, pool } from '../datos/conexion';
import { crearLocal, type LocalCreado } from '../datos/semilla';
import type { DiaSemana } from '../dominio/tipos';
import {
  borrarDuracion,
  borrarExcepcion,
  borrarFranja,
  cambiarActivaFranja,
  cambiarHorarioDeUnDia,
  cargarConfiguracion,
  copiarHorarioDeDia,
  guardarDuracion,
  guardarExcepcion,
  guardarFranja,
  horarioSemanal,
  ponerDuracionPareja,
  quitarDiaDeFranja,
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

describe('días especiales', () => {
  const fecha = '2026-12-26';

  it('un día puede tener dos tramos con horarios propios', async () => {
    await guardarExcepcion(app, local.tenantId, {
      fecha, cerrado: false, desde: '11:00', hasta: '15:00', motivo: 'Brunch',
    });
    await guardarExcepcion(app, local.tenantId, {
      fecha, cerrado: false, desde: '18:00', hasta: '02:00', motivo: 'Fiesta',
    });

    const config = await cargarConfiguracion(app, local.tenantId);
    const delDia = config.excepciones.filter((e) => e.fecha === fecha);
    expect(delDia).toHaveLength(2);
    expect(delDia.map((e) => e.motivo)).toEqual(['Brunch', 'Fiesta']);
  });

  it('marcar cerrado borra los tramos de esa fecha', async () => {
    await guardarExcepcion(app, local.tenantId, {
      fecha, cerrado: false, desde: '11:00', hasta: '15:00',
    });
    await guardarExcepcion(app, local.tenantId, { fecha, cerrado: true, motivo: 'Feriado' });

    const config = await cargarConfiguracion(app, local.tenantId);
    const delDia = config.excepciones.filter((e) => e.fecha === fecha);
    expect(delDia).toHaveLength(1);
    expect(delDia[0]).toMatchObject({ cerrado: true, motivo: 'Feriado' });
  });

  it('agregar un tramo levanta el cierre de esa fecha', async () => {
    await guardarExcepcion(app, local.tenantId, { fecha, cerrado: true, motivo: 'Feriado' });
    await guardarExcepcion(app, local.tenantId, {
      fecha, cerrado: false, desde: '20:00', hasta: '23:00', motivo: 'Al final abrimos',
    });

    const delDia = (await cargarConfiguracion(app, local.tenantId)).excepciones.filter(
      (e) => e.fecha === fecha,
    );
    expect(delDia).toHaveLength(1);
    expect(delDia[0]!.cerrado).toBe(false);
  });

  it('guarda el último ingreso y la franja para las duraciones', async () => {
    const config = await cargarConfiguracion(app, local.tenantId);
    const cena = config.franjas.find((f) => f.nombre === 'Cena')!;

    await guardarExcepcion(app, local.tenantId, {
      fecha, cerrado: false, desde: '18:00', hasta: '23:00',
      ultimoIngreso: '21:30', franjaId: cena.id,
    });

    const guardada = (await cargarConfiguracion(app, local.tenantId)).excepciones.find(
      (e) => e.fecha === fecha,
    )!;
    expect(guardada.ultimoIngreso).toBe('21:30');
    expect(guardada.franjaId).toBe(cena.id);
  });

  it('rechaza un último ingreso fuera del tramo', async () => {
    const resultado = await guardarExcepcion(app, local.tenantId, {
      fecha, cerrado: false, desde: '18:00', hasta: '23:00', ultimoIngreso: '09:00',
    });
    expect(resultado).toMatchObject({ tipo: 'invalido' });
  });

  it('acepta un último ingreso de madrugada si el tramo cruza medianoche', async () => {
    expect(
      await guardarExcepcion(app, local.tenantId, {
        fecha, cerrado: false, desde: '20:00', hasta: '03:00', ultimoIngreso: '01:30',
      }),
    ).toEqual({ tipo: 'ok' });
  });

  it('rechaza un tramo que abre y cierra a la misma hora', async () => {
    expect(
      await guardarExcepcion(app, local.tenantId, {
        fecha, cerrado: false, desde: '20:00', hasta: '20:00',
      }),
    ).toMatchObject({ tipo: 'invalido' });
  });
});

describe('el horario visto por día', () => {
  // Local propio: estos tests parten y recomponen franjas, y arrastrar eso a los demás
  // haría fallar cosas que no tienen nada que ver.
  let semanal: LocalCreado;

  beforeAll(async () => {
    semanal = await crearLocal(admin, {
      slug: `sem-${Date.now()}`, nombre: 'Bar Semana', salones: [],
    });
  });
  afterAll(async () => {
    await admin.query('DELETE FROM tenants WHERE id = $1', [semanal.tenantId]);
  });

  const dia = async (n: DiaSemana) =>
    (await horarioSemanal(app, semanal.tenantId)).find((d) => d.dia === n)!;

  it('arranca en lunes y termina en domingo, como el cartel de la puerta', async () => {
    const semana = await horarioSemanal(app, semanal.tenantId);
    expect(semana.map((d) => d.nombre)).toEqual([
      'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo',
    ]);
  });

  it('cada día muestra sus tramos ordenados por hora de apertura', async () => {
    const martes = await dia(2);
    expect(martes.tramos.map((t) => t.nombre)).toEqual(['Almuerzo', 'Cena']);
    expect(martes.tramos[0]!.desde).toBe('12:00');
    expect(martes.tramos[1]!.desde).toBe('20:00');
    // Las franjas sembradas van todos los días: cambiarlas acá toca el resto.
    expect(martes.tramos.every((t) => t.compartida)).toBe(true);
  });

  it('cambiar un día parte la franja y deja los otros como estaban', async () => {
    // Es el punto entero: "los viernes abrimos más tarde" no puede mover el martes.
    const antes = await dia(5);
    const cenaDelViernes = antes.tramos.find((t) => t.nombre === 'Cena')!;

    expect(
      await cambiarHorarioDeUnDia(app, semanal.tenantId, {
        franjaId: cenaDelViernes.franjaId,
        dia: 5,
        desde: '21:00',
        hasta: '04:00',
        ultimoIngreso: '03:00',
      }),
    ).toEqual({ tipo: 'ok' });

    const viernes = await dia(5);
    const martes = await dia(2);

    expect(viernes.tramos.find((t) => t.nombre === 'Cena')).toMatchObject({
      desde: '21:00', hasta: '04:00', ultimoIngreso: '03:00', compartida: false,
    });
    expect(martes.tramos.find((t) => t.nombre === 'Cena')).toMatchObject({
      desde: '20:00', hasta: '02:00',
    });
  });

  it('y si la franja ya era de un solo día, la edita sin partir nada', async () => {
    const viernes = await dia(5);
    const cena = viernes.tramos.find((t) => t.nombre === 'Cena')!;
    expect(cena.compartida).toBe(false);

    await cambiarHorarioDeUnDia(app, semanal.tenantId, {
      franjaId: cena.franjaId, dia: 5, desde: '21:30', hasta: '04:00', ultimoIngreso: '03:00',
    });

    const despues = await dia(5);
    expect(despues.tramos.filter((t) => t.nombre === 'Cena')).toHaveLength(1);
    expect(despues.tramos.find((t) => t.nombre === 'Cena')!.desde).toBe('21:30');
  });

  it('quitar un día de una franja no toca a los demás', async () => {
    const lunes = await dia(1);
    const almuerzo = lunes.tramos.find((t) => t.nombre === 'Almuerzo')!;

    await quitarDiaDeFranja(app, semanal.tenantId, almuerzo.franjaId, 1);

    expect((await dia(1)).tramos.map((t) => t.nombre)).toEqual(['Cena']);
    expect((await dia(2)).tramos.map((t) => t.nombre)).toEqual(['Almuerzo', 'Cena']);
  });

  it('un día sin tramos es un día cerrado, y se puede dejar así', async () => {
    const lunes = await dia(1);
    for (const t of lunes.tramos) {
      await quitarDiaDeFranja(app, semanal.tenantId, t.franjaId, 1);
    }
    expect((await dia(1)).tramos).toEqual([]);
  });

  it('copiar de otro día reabre el que estaba cerrado', async () => {
    expect((await dia(1)).tramos).toEqual([]);

    expect(await copiarHorarioDeDia(app, semanal.tenantId, 2, 1)).toEqual({ tipo: 'ok' });

    const lunes = await dia(1);
    const martes = await dia(2);
    expect(lunes.tramos.map((t) => `${t.nombre} ${t.desde}-${t.hasta}`)).toEqual(
      martes.tramos.map((t) => `${t.nombre} ${t.desde}-${t.hasta}`),
    );
  });

  it('copiar reemplaza lo que tenía el día destino, no lo suma', async () => {
    await copiarHorarioDeDia(app, semanal.tenantId, 2, 1);
    await copiarHorarioDeDia(app, semanal.tenantId, 2, 1);

    expect((await dia(1)).tramos).toHaveLength((await dia(2)).tramos.length);
  });

  it('no se copia un día que está cerrado: no hay nada que copiar', async () => {
    for (const t of (await dia(3)).tramos) {
      await quitarDiaDeFranja(app, semanal.tenantId, t.franjaId, 3);
    }
    expect(await copiarHorarioDeDia(app, semanal.tenantId, 3, 4)).toMatchObject({
      tipo: 'invalido',
    });
  });

  it('copiar un día sobre sí mismo no hace nada', async () => {
    expect(await copiarHorarioDeDia(app, semanal.tenantId, 2, 2)).toMatchObject({
      tipo: 'invalido',
    });
  });

  it('rechaza un horario imposible sin tocar lo que había', async () => {
    const martes = await dia(2);
    const cena = martes.tramos.find((t) => t.nombre === 'Cena')!;

    const resultado = await cambiarHorarioDeUnDia(app, semanal.tenantId, {
      franjaId: cena.franjaId, dia: 2, desde: '20:00', hasta: '02:00', ultimoIngreso: '15:00',
    });

    expect(resultado).toMatchObject({ tipo: 'invalido' });
    expect((await dia(2)).tramos.find((t) => t.nombre === 'Cena')!.ultimoIngreso).toBe('01:00');
  });

  it('no duplica franjas: un día que vuelve a su horario se reagrupa', async () => {
    // Sin esto, cada edición por día deja una fila más en "Cuándo abre" y en un mes la
    // lista es ilegible.
    const antes = (await cargarConfiguracion(app, semanal.tenantId)).franjas.length;

    const jueves = await dia(4);
    const cena = jueves.tramos.find((t) => t.nombre === 'Cena')!;
    // Se lo manda a un horario propio...
    await cambiarHorarioDeUnDia(app, semanal.tenantId, {
      franjaId: cena.franjaId, dia: 4, desde: '19:00', hasta: '02:00', ultimoIngreso: '01:00',
    });
    const partido = (await cargarConfiguracion(app, semanal.tenantId)).franjas.length;
    expect(partido).toBe(antes + 1);

    // ...y al volver al horario del resto, se reengancha en vez de dejar una copia.
    const jueveSolo = (await dia(4)).tramos.find((t) => t.nombre === 'Cena')!;
    await cambiarHorarioDeUnDia(app, semanal.tenantId, {
      franjaId: jueveSolo.franjaId, dia: 4, desde: '20:00', hasta: '02:00', ultimoIngreso: '01:00',
    });

    const config = await cargarConfiguracion(app, semanal.tenantId);
    expect(config.franjas.length).toBe(antes);
    expect((await dia(4)).tramos.find((t) => t.nombre === 'Cena')).toMatchObject({
      desde: '20:00', compartida: true,
    });
  });

  it('pero no borra una franja que tiene reglas de duración propias', async () => {
    // Perder en silencio cómo rota ese día es mucho peor que dejar una fila repetida.
    const sabado = await dia(6);
    const cena = sabado.tramos.find((t) => t.nombre === 'Cena')!;
    await cambiarHorarioDeUnDia(app, semanal.tenantId, {
      franjaId: cena.franjaId, dia: 6, desde: '19:00', hasta: '02:00', ultimoIngreso: '01:00',
    });

    const propia = (await dia(6)).tramos.find((t) => t.nombre === 'Cena')!;
    await guardarDuracion(app, semanal.tenantId, {
      franjaId: propia.franjaId, personasMin: 1, personasMax: 99,
      duracionMin: 180, bufferMin: 0,
    });

    // Vuelve al horario del resto: la franja sobrevive porque tiene regla propia.
    await cambiarHorarioDeUnDia(app, semanal.tenantId, {
      franjaId: propia.franjaId, dia: 6, desde: '20:00', hasta: '02:00', ultimoIngreso: '01:00',
    });

    const config = await cargarConfiguracion(app, semanal.tenantId);
    expect(config.franjas.some((f) => f.id === propia.franjaId)).toBe(true);
    expect(config.duraciones.some((d) => d.franjaId === propia.franjaId)).toBe(true);
  });

  it('el motor respeta el horario partido', async () => {
    // El viernes cambió a 21:30; el martes sigue abriendo 20:00. Una reserva de las
    // 20:30 tiene que entrar el martes y no el viernes.
    const config = await cargarConfiguracion(app, semanal.tenantId);
    const viernes = config.franjas.find((f) => f.dias.length === 1 && f.dias[0] === 5);
    expect(viernes?.desde).toBe('21:30');
  });
});
