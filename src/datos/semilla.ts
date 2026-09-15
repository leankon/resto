import type pg from 'pg';
import { reglasSembradas } from '../dominio/turnos';

export interface MesaNueva {
  nombre: string;
  capacidadBase: number;
  cabeceras?: number;
  capacidadMin?: number;
  x: number;
  y: number;
  combinable?: boolean;
}

export interface SalonNuevo {
  nombre: string;
  mesas: MesaNueva[];
}

export interface LocalNuevo {
  slug: string;
  nombre: string;
  tz?: string;
  pais?: string;
  salones: SalonNuevo[];
}

export interface LocalCreado {
  tenantId: string;
  salones: Record<string, string>;
  mesas: Record<string, string>;
}

/**
 * Alta de un local nuevo, con franjas y duraciones de turno ya sembradas.
 *
 * Usa la conexión de administrador: crear un tenant es, por definición, la única
 * operación que no puede estar dentro del alcance de ningún tenant. Es lo que corre
 * detrás del panel de super-admin.
 */
export async function crearLocal(admin: pg.Pool, datos: LocalNuevo): Promise<LocalCreado> {
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    const { rows: tenants } = await c.query(
      `INSERT INTO tenants (slug, nombre, tz, pais) VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        datos.slug,
        datos.nombre,
        datos.tz ?? 'America/Argentina/Buenos_Aires',
        datos.pais ?? 'AR',
      ],
    );
    const tenantId = tenants[0].id as string;

    const franja = async (nombre: string, desde: string, hasta: string, ultimo: string) => {
      const { rows } = await c.query(
        `INSERT INTO franjas_servicio (tenant_id, nombre, dias, desde, hasta, ultimo_ingreso)
         VALUES ($1, $2, '{0,1,2,3,4,5,6}', $3, $4, $5) RETURNING id`,
        [tenantId, nombre, desde, hasta, ultimo],
      );
      return rows[0].id as string;
    };
    // La cena cierra a las 02:00: cruza medianoche a propósito, es lo normal acá.
    const almuerzo = await franja('Almuerzo', '12:00', '16:00', '15:00');
    const cena = await franja('Cena', '20:00', '02:00', '01:00');

    for (const regla of reglasSembradas(almuerzo, cena)) {
      await c.query(
        `INSERT INTO duraciones_turno
           (tenant_id, franja_id, personas_min, personas_max, duracion_min, buffer_min)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          tenantId,
          regla.franjaId,
          regla.personasMin,
          regla.personasMax,
          regla.duracionMin,
          regla.bufferMin,
        ],
      );
    }

    const salones: Record<string, string> = {};
    const mesas: Record<string, string> = {};
    for (const [orden, salon] of datos.salones.entries()) {
      const { rows } = await c.query(
        `INSERT INTO salones (tenant_id, nombre, orden) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, salon.nombre, orden],
      );
      const salonId = rows[0].id as string;
      salones[salon.nombre] = salonId;

      for (const mesa of salon.mesas) {
        const creada = await c.query(
          `INSERT INTO mesas (tenant_id, salon_id, nombre, capacidad_base, cabeceras,
                              capacidad_min, x, y, combinable)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            tenantId,
            salonId,
            mesa.nombre,
            mesa.capacidadBase,
            mesa.cabeceras ?? 0,
            mesa.capacidadMin ?? 1,
            mesa.x,
            mesa.y,
            mesa.combinable ?? true,
          ],
        );
        mesas[mesa.nombre] = creada.rows[0].id as string;
      }
    }

    await c.query('COMMIT');
    return { tenantId, salones, mesas };
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}

/** Salón de ejemplo, el mismo con el que se testea el motor. */
export const SALON_DEMO: SalonNuevo[] = [
  {
    nombre: 'Planta baja',
    mesas: [
      { nombre: '1', capacidadBase: 2, x: 0, y: 0 },
      { nombre: '2', capacidadBase: 2, x: 200, y: 0 },
      { nombre: '3', capacidadBase: 2, x: 420, y: 0 },
      { nombre: '4', capacidadBase: 4, cabeceras: 2, x: 1000, y: 0 },
      { nombre: '5', capacidadBase: 6, x: 2000, y: 0 },
      { nombre: '6', capacidadBase: 3, x: 3000, y: 0 },
      { nombre: '7', capacidadBase: 3, x: 3200, y: 0 },
      { nombre: '8', capacidadBase: 8, capacidadMin: 5, x: 4000, y: 0 },
    ],
  },
  {
    nombre: 'Terraza',
    mesas: [
      { nombre: 'T1', capacidadBase: 4, x: 0, y: 0 },
      { nombre: 'T2', capacidadBase: 4, x: 200, y: 0 },
    ],
  },
];
