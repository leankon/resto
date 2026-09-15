import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { URL_ADMIN, conTenant, esSolape, pool } from './conexion';

const admin = new pg.Pool({ connectionString: URL_ADMIN });
const app = pool();

let tenantA: string;
let tenantB: string;
let mesaA: string;
let clienteA: string;

const RANGO = '[2026-09-15 21:00+00, 2026-09-15 23:00+00)';

async function crearLocal(slug: string) {
  const { rows } = await admin.query(
    `INSERT INTO tenants (slug, nombre) VALUES ($1, $1) RETURNING id`,
    [slug],
  );
  const tenantId = rows[0].id as string;
  const salon = await admin.query(
    `INSERT INTO salones (tenant_id, nombre) VALUES ($1, 'PB') RETURNING id`,
    [tenantId],
  );
  const mesa = await admin.query(
    `INSERT INTO mesas (tenant_id, salon_id, nombre, capacidad_base)
     VALUES ($1, $2, '1', 4) RETURNING id`,
    [tenantId, salon.rows[0].id],
  );
  const cliente = await admin.query(
    `INSERT INTO clientes (tenant_id, telefono_e164, telefono_clave, nombre)
     VALUES ($1, '+5491100000000', '+541100000000', 'Cliente') RETURNING id`,
    [tenantId],
  );
  return { tenantId, mesaId: mesa.rows[0].id as string, clienteId: cliente.rows[0].id as string };
}

/** Crea una reserva y la sienta en una mesa, en una sola transacción. */
async function reservar(
  cliente: pg.PoolClient,
  opciones: { tenantId: string; mesaId: string; clienteId: string | null; rango?: string; estado?: string },
) {
  const { rows } = await cliente.query(
    `INSERT INTO reservas (tenant_id, cliente_id, inicio, duracion_min, personas, canal_origen, estado)
     VALUES ($1, $2, '2026-09-15 21:00+00', 105, 4, $3, $4) RETURNING id`,
    [
      opciones.tenantId,
      opciones.clienteId,
      opciones.clienteId ? 'web' : 'walk_in',
      opciones.estado ?? 'confirmada',
    ],
  );
  const reservaId = rows[0].id as string;
  await cliente.query(
    `INSERT INTO reservas_mesas (tenant_id, reserva_id, mesa_id, periodo)
     VALUES ($1, $2, $3, $4::tstzrange)`,
    [opciones.tenantId, reservaId, opciones.mesaId, opciones.rango ?? RANGO],
  );
  return reservaId;
}

beforeAll(async () => {
  const a = await crearLocal(`bar-a-${Date.now()}`);
  const b = await crearLocal(`bar-b-${Date.now()}`);
  tenantA = a.tenantId;
  mesaA = a.mesaId;
  clienteA = a.clienteId;
  tenantB = b.tenantId;
});

beforeEach(async () => {
  await admin.query('DELETE FROM reservas WHERE tenant_id = ANY($1)', [[tenantA, tenantB]]);
});

afterAll(async () => {
  await admin.query('DELETE FROM tenants WHERE id = ANY($1)', [[tenantA, tenantB]]);
  await Promise.all([admin.end(), app.end()]);
});

describe('constraint EXCLUDE: doble booking', () => {
  it('rechaza dos reservas en la misma mesa a la misma hora', async () => {
    await conTenant(app, tenantA, (c) => reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA }));

    await expect(
      conTenant(app, tenantA, (c) =>
        reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA }),
      ),
    ).rejects.toSatisfy(esSolape);
  });

  it('rechaza también un solape parcial', async () => {
    await conTenant(app, tenantA, (c) => reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA }));

    await expect(
      conTenant(app, tenantA, (c) =>
        reservar(c, {
          tenantId: tenantA,
          mesaId: mesaA,
          clienteId: clienteA,
          rango: '[2026-09-15 22:30+00, 2026-09-16 00:30+00)',
        }),
      ),
    ).rejects.toSatisfy(esSolape);
  });

  it('acepta una reserva que arranca justo cuando termina la anterior', async () => {
    // Los periodos son semiabiertos: tocarse en el borde no es solaparse.
    await conTenant(app, tenantA, (c) => reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA }));
    await expect(
      conTenant(app, tenantA, (c) =>
        reservar(c, {
          tenantId: tenantA,
          mesaId: mesaA,
          clienteId: clienteA,
          rango: '[2026-09-15 23:00+00, 2026-09-16 01:00+00)',
        }),
      ),
    ).resolves.toBeTypeOf('string');
  });

  it('un walk-in bloquea la mesa igual que una reserva (D6)', async () => {
    await conTenant(app, tenantA, (c) =>
      reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: null, estado: 'sentada' }),
    );
    await expect(
      conTenant(app, tenantA, (c) =>
        reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA }),
      ),
    ).rejects.toSatisfy(esSolape);
  });

  it('una oferta de lista de espera bloquea la mesa mientras el cliente decide', async () => {
    // El hold ES una reserva provisional: por eso no existe la ventana en la que
    // dos personas reciben la misma mesa.
    await conTenant(app, tenantA, (c) =>
      reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA, estado: 'hold' }),
    );
    await expect(
      conTenant(app, tenantA, (c) =>
        reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA }),
      ),
    ).rejects.toSatisfy(esSolape);
  });

  it('cancelar libera la mesa sin borrar el historial', async () => {
    const reservaId = await conTenant(app, tenantA, (c) =>
      reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA }),
    );
    await conTenant(app, tenantA, async (c) => {
      await c.query(`UPDATE reservas SET estado = 'cancelada' WHERE id = $1`, [reservaId]);
    });

    await expect(
      conTenant(app, tenantA, (c) =>
        reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA }),
      ),
    ).resolves.toBeTypeOf('string');

    const { rows } = await admin.query('SELECT estado FROM reservas WHERE id = $1', [reservaId]);
    expect(rows[0].estado).toBe('cancelada'); // la fila sigue ahí
  });

  it('una reserva finalizada sigue ocupando lo que ocupó', async () => {
    // Liberar antes se hace achicando el periodo, no borrando el hecho.
    const reservaId = await conTenant(app, tenantA, (c) =>
      reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA }),
    );
    await conTenant(app, tenantA, async (c) => {
      await c.query(`UPDATE reservas SET estado = 'finalizada' WHERE id = $1`, [reservaId]);
    });
    await expect(
      conTenant(app, tenantA, (c) =>
        reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA }),
      ),
    ).rejects.toSatisfy(esSolape);

    // Achicar el periodo devuelve los minutos al inventario.
    await conTenant(app, tenantA, async (c) => {
      await c.query(
        `UPDATE reservas_mesas SET periodo = '[2026-09-15 21:00+00, 2026-09-15 21:45+00)'
          WHERE reserva_id = $1`,
        [reservaId],
      );
    });
    await expect(
      conTenant(app, tenantA, (c) =>
        reservar(c, {
          tenantId: tenantA,
          mesaId: mesaA,
          clienteId: clienteA,
          rango: '[2026-09-15 22:00+00, 2026-09-15 23:30+00)',
        }),
      ),
    ).resolves.toBeTypeOf('string');
  });
});

describe('row level security', () => {
  it('un local no ve las reservas de otro ni buscándolas a propósito', async () => {
    await conTenant(app, tenantA, (c) => reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA }));

    // Consulta sin WHERE tenant_id: el bug clásico del modelo de tabla compartida.
    const desdeB = await conTenant(app, tenantB, (c) => c.query('SELECT * FROM reservas'));
    expect(desdeB.rows).toHaveLength(0);

    const desdeA = await conTenant(app, tenantA, (c) => c.query('SELECT * FROM reservas'));
    expect(desdeA.rows).toHaveLength(1);
  });

  it('no deja escribir una fila con el tenant de otro', async () => {
    await expect(
      conTenant(app, tenantB, (c) =>
        reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('sin tenant fijado no se ve nada', async () => {
    await conTenant(app, tenantA, (c) => reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA }));
    const cliente = await app.connect();
    try {
      const { rows } = await cliente.query('SELECT * FROM reservas');
      expect(rows).toHaveLength(0);
    } finally {
      cliente.release();
    }
  });

  it('el historial de clientes no se cruza entre locales', async () => {
    // El mismo teléfono en dos locales son dos filas distintas, a propósito.
    const { rows } = await admin.query(
      `SELECT tenant_id FROM clientes WHERE telefono_clave = '+541100000000'
         AND tenant_id = ANY($1)`,
      [[tenantA, tenantB]],
    );
    expect(rows).toHaveLength(2);

    const vistosPorA = await conTenant(app, tenantA, (c) =>
      c.query(`SELECT id FROM clientes WHERE telefono_clave = '+541100000000'`),
    );
    expect(vistosPorA.rows).toHaveLength(1);
  });

  it('el super-admin ve todos los locales, por política explícita', async () => {
    await conTenant(app, tenantA, (c) => reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA }));
    const { rows } = await admin.query('SELECT * FROM reservas');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('ningún rol de la app es superusuario ni ignora RLS', async () => {
    // Es lo que hace desplegable el esquema: en Postgres gestionado (Supabase, Neon,
    // RDS) nadie es superusuario de verdad, así que un esquema que dependa de eso no
    // se puede instalar. Y de paso, RLS no se puede saltear ni por accidente.
    const { rows } = await admin.query(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname LIKE 'resto\\_%'`,
    );
    expect(rows.length).toBe(3);
    for (const rol of rows) {
      expect({ [rol.rolname]: [rol.rolsuper, rol.rolbypassrls] }).toEqual({
        [rol.rolname]: [false, false],
      });
    }
  });
});

describe('carrera entre canales', () => {
  it('dos reservas simultáneas para la misma mesa: una entra, la otra falla limpio', async () => {
    // Web y WhatsApp pidiendo lo mismo en el mismo instante, sin advisory lock:
    // la constraint sola ya alcanza para que no haya doble booking.
    const intentar = () =>
      conTenant(app, tenantA, (c) =>
        reservar(c, { tenantId: tenantA, mesaId: mesaA, clienteId: clienteA }),
      );

    const resultados = await Promise.allSettled([intentar(), intentar(), intentar()]);
    const exitosas = resultados.filter((r) => r.status === 'fulfilled');
    const fallidas = resultados.filter((r) => r.status === 'rejected');

    expect(exitosas).toHaveLength(1);
    expect(fallidas).toHaveLength(2);
    for (const fallida of fallidas) {
      expect(esSolape((fallida as PromiseRejectedResult).reason)).toBe(true);
    }
  });
});
