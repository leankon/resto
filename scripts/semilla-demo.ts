/**
 * Datos de prueba para poder abrir el panel y ver algo.
 *
 *   npm run db:demo
 */
import pg from 'pg';
import { URL_ADMIN, URL_APP } from '../src/datos/conexion';
import { SALON_DEMO } from '../src/datos/semilla';
import { altaDeLocal, crearAdminPlataforma } from '../src/servicios/administracion';
import { crearReserva, ocuparMesa } from '../src/servicios/reservas';
import { hoyEn, instanteLocal } from '../src/web/formato';

const admin = new pg.Pool({ connectionString: URL_ADMIN });
const app = new pg.Pool({ connectionString: URL_APP });
const TZ = 'America/Argentina/Buenos_Aires';

await crearAdminPlataforma(admin, {
  email: 'admin@plataforma.test',
  nombre: 'Admin Plataforma',
  password: 'plataforma-123',
});

await admin.query(`DELETE FROM tenants WHERE slug = 'bar-demo'`);
await admin.query(`DELETE FROM usuarios WHERE email = 'duenio@bardemo.test'`);

const local = await altaDeLocal(admin, {
  slug: 'bar-demo',
  nombre: 'Bar Demo',
  tz: TZ,
  salones: SALON_DEMO,
  duenio: { email: 'duenio@bardemo.test', nombre: 'Marta Dueña', password: 'bar-demo-123' },
});

const hoy = hoyEn(TZ);
const actor = { tipo: 'staff' as const, id: local.usuarioId };
const gente: Array<[string, number, string, string, string]> = [
  ['20:30', 2, 'Sofía Ramírez', '011 15 2345-6789', 'web'],
  ['21:00', 4, 'Julián Ortiz', '1155551234', 'whatsapp'],
  ['21:00', 6, 'Familia Pereyra', '1144445555', 'manual'],
  ['21:15', 2, 'Nico y Flor', '1166667777', 'web'],
  ['21:30', 8, 'Cumpleaños de Lu', '1133332222', 'whatsapp'],
  ['22:00', 3, 'Mesa de trabajo', '1177778888', 'widget'],
  ['22:30', 2, 'Carla Benítez', '1199990000', 'web'],
];

for (const [hora, personas, nombre, telefono, canal] of gente) {
  const resultado = await crearReserva(app, {
    tenantId: local.tenantId,
    inicio: instanteLocal(hoy, hora, TZ),
    personas,
    canalOrigen: canal as 'web',
    contacto: { nombre, telefono },
    actor,
  });
  console.log(
    `${hora} ${nombre.padEnd(20)} ${String(personas).padStart(2)}p ->`,
    resultado.tipo === 'creada'
      ? `mesa ${resultado.mesas.map((m) => m.nombre).join('+')}`
      : resultado.tipo,
  );
}

await ocuparMesa(app, {
  tenantId: local.tenantId,
  mesaIds: [local.mesas['3']!],
  personas: 2,
  inicio: instanteLocal(hoy, '20:45', TZ),
  actor,
});

console.log('\nListo.');
console.log('  Panel:  duenio@bardemo.test / bar-demo-123');
console.log('  Admin:  admin@plataforma.test / plataforma-123');

await Promise.all([admin.end(), app.end()]);
