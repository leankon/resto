/**
 * Recorrido de humo sobre horarios, turnos y días especiales.
 *
 *   npm run db:demo && npm start   # en otra terminal
 *   npm run humo:horarios
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const capturas = process.env.CAPTURAS ?? '/tmp/capturas';
mkdirSync(capturas, { recursive: true });

/**
 * La fecha en la zona del local, no en UTC.
 *
 * `new Date().toISOString()` da el día UTC: pasadas las 21:00 de Buenos Aires ya
 * devuelve el día siguiente, y el recorrido busca reservas en una planilla vacía. El
 * fallo aparece según la hora a la que se corra, que es la peor forma de fallar.
 */
const TZ_LOCAL = 'America/Argentina/Buenos_Aires';
const fechaLocal = (dias = 0) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_LOCAL, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + dias * 86400000));

const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pagina = await navegador.newPage({ viewport: { width: 1180, height: 1100 } });
const errores = [];
pagina.on('pageerror', (e) => errores.push(String(e)));

await pagina.goto('http://localhost:3000/login');
await pagina.fill('input[name=email]', 'duenio@bardemo.test');
await pagina.fill('input[name=password]', 'bar-demo-123');
await pagina.click('button[type=submit]');
await pagina.waitForSelector('.marca');

console.log('1. abrir horarios desde el panel');
await pagina.getByRole('link', { name: 'Horarios', exact: true }).click();
await pagina.waitForSelector('h1');
const franjas = await pagina.locator('section').filter({ hasText: 'Cuándo abre' })
  .locator('tbody tr').count();
const duraciones = await pagina.locator('section').filter({ hasText: 'Cuánto dura un turno' })
  .locator('tbody tr').count();
console.log(`   franjas: ${franjas} | reglas de duración: ${duraciones}`);
await pagina.screenshot({ path: `${capturas}/horarios-1.png`, fullPage: true });

console.log('2. cambiar el horario de la cena');
const filaCena = pagina.locator('tbody tr').filter({ has: pagina.locator('input[value="Cena"]') });
await filaCena.locator('input[name=hasta]').fill('01:00');
await filaCena.getByRole('button', { name: 'Guardar' }).click();
await pagina.waitForTimeout(1500);
console.log('   cierre ahora:', await filaCena.locator('input[name=hasta]').inputValue());

console.log('3. rechaza un último ingreso fuera del horario');
await filaCena.locator('input[name=ultimoIngreso]').fill('10:00');
await filaCena.getByRole('button', { name: 'Guardar' }).click();
await pagina.waitForSelector('.aviso');
console.log('   ->', (await pagina.locator('.aviso').first().textContent()).trim());
await filaCena.locator('input[name=ultimoIngreso]').fill('00:30');
await filaCena.getByRole('button', { name: 'Guardar' }).click();
await pagina.waitForTimeout(1500);

console.log('4. agregar una franja nueva');
const altaFranja = pagina.locator('form').filter({ hasText: 'Nueva franja' });
await altaFranja.locator('input[name=nombre]').fill('Brunch');
await altaFranja.locator('input[name=desde]').fill('10:00');
await altaFranja.locator('input[name=hasta]').fill('13:00');
await altaFranja.locator('input[name=ultimoIngreso]').fill('12:00');
await altaFranja.getByRole('button', { name: 'Agregar' }).click();
await pagina.waitForTimeout(1500);
console.log('   franjas ahora:', await pagina.locator('section')
  .filter({ hasText: 'Cuándo abre' }).locator('tbody tr').count());

console.log('5. cambiar cuánto dura un turno');
const primeraDuracion = pagina.locator('section').filter({ hasText: 'Cuánto dura un turno' })
  .locator('tbody tr').first();
await primeraDuracion.locator('input[name=duracionMin]').fill('60');
await primeraDuracion.getByRole('button', { name: 'Guardar' }).click();
await pagina.waitForTimeout(1500);
console.log('   duración:', await primeraDuracion.locator('input[name=duracionMin]').inputValue());

console.log('6. el navegador no deja guardar una duración imposible');
await primeraDuracion.locator('input[name=duracionMin]').fill('5');
await primeraDuracion.getByRole('button', { name: 'Guardar' }).click();
await pagina.waitForTimeout(1200);
await pagina.reload();
await pagina.waitForSelector('h1');
const guardada = await pagina.locator('section').filter({ hasText: 'Cuánto dura un turno' })
  .locator('tbody tr').first().locator('input[name=duracionMin]').inputValue();
console.log('   quedó en', guardada, guardada === '60' ? '(no se guardó el 5)' : '(SE GUARDÓ MAL)');

console.log('7. marcar un feriado como cerrado');
const hoy = new Date();
const feriado = fechaLocal(3);
const altaExcepcion = pagina.locator('form').filter({ hasText: 'Motivo' });
await altaExcepcion.locator('input[name=fecha]').fill(feriado);
await altaExcepcion.locator('input[name=motivo]').fill('Feriado');
await altaExcepcion.getByRole('button', { name: 'Agregar' }).click();
await pagina.waitForTimeout(1500);
console.log('   días especiales:', await pagina.locator('section')
  .filter({ hasText: 'Días especiales' }).locator('tbody tr').count());
await pagina.screenshot({ path: `${capturas}/horarios-2.png`, fullPage: true });

console.log('8. el feriado bloquea una reserva de mostrador');
await pagina.goto('http://localhost:3000/panel/nueva');
await pagina.waitForSelector('input[name=nombre]');
await pagina.fill('input[name=fecha]', feriado);
await pagina.fill('input[name=hora]', '21:00');
await pagina.fill('input[name=nombre]', 'Prueba Feriado');
await pagina.fill('input[name=telefono]', '1155559090');
await pagina.click('button[type=submit]');
await pagina.waitForSelector('.aviso');
console.log('   ->', (await pagina.textContent('.aviso')).trim());

console.log('9. cambiar un solo día no mueve el resto de la semana');
await pagina.goto('http://localhost:3000/panel/horarios');
await pagina.waitForSelector('h1');
const semana = pagina.locator('section').filter({ hasText: 'La semana' });
const filaDe = (nombre) => semana.locator('tbody tr').filter({ hasText: nombre });
const cenaDe = (nombre) => filaDe(nombre).locator('form.tramo').filter({ hasText: 'Cena' });

const martesAntes = await cenaDe('Martes').locator('input[name=desde]').inputValue();
const viernes = cenaDe('Viernes');
await viernes.locator('input[name=desde]').fill('21:30');
await viernes.getByRole('button', { name: 'Guardar' }).click();
await pagina.waitForTimeout(1800);

const viernesDespues = await cenaDe('Viernes').locator('input[name=desde]').inputValue();
const martesDespues = await cenaDe('Martes').locator('input[name=desde]').inputValue();
console.log(`   viernes: ${viernesDespues} (era ${martesAntes})`);
console.log(`   martes:  ${martesDespues}`,
  martesDespues === martesAntes ? '(quedó como estaba)' : '(SE MOVIÓ, MAL)');
await pagina.screenshot({ path: `${capturas}/horarios-semana.png`, fullPage: true });

console.log('10. cerrar un día y reabrirlo copiando de otro');
const lunes = () => filaDe('Lunes');
let tramosLunes = await lunes().locator('form.tramo').count();
for (let i = 0; i < tramosLunes; i++) {
  await lunes().locator('form.tramo').first().getByRole('button', { name: 'Quitar' }).click();
  await pagina.waitForTimeout(1200);
}
console.log('   lunes ahora:', (await lunes().textContent()).replace(/\s+/g, ' ').trim());

await lunes().locator('select[name=origen]').selectOption({ label: 'Como el martes' });
await lunes().getByRole('button', { name: 'Abrir' }).click();
await pagina.waitForTimeout(1800);
tramosLunes = await lunes().locator('form.tramo').count();
const tramosMartes = await filaDe('Martes').locator('form.tramo').count();
console.log(`   lunes reabierto con ${tramosLunes} tramos`,
  tramosLunes === tramosMartes ? '(igual que el martes)' : '(NO COINCIDE)');

console.log('11. un día especial que abre ANTES de lo habitual');
// La cena arranca a las 20:00. Este día se abre a las 18:00, que con la regla vieja
// —los días especiales solo recortaban— era imposible de decir.
const especial = fechaLocal(5);
await pagina.goto('http://localhost:3000/panel/horarios');
await pagina.waitForSelector('h1');
const alta = pagina.locator('form').filter({ hasText: 'Motivo' });
await alta.locator('input[name=fecha]').fill(especial);
await alta.locator('input[name=cerrado]').uncheck();
await alta.locator('input[name=desde]').fill('18:00');
await alta.locator('input[name=hasta]').fill('23:00');
await alta.locator('input[name=motivo]').fill('Abrimos temprano');
await alta.getByRole('button', { name: 'Agregar' }).click();
await pagina.waitForTimeout(1500);

await pagina.goto('http://localhost:3000/panel/nueva');
await pagina.waitForSelector('input[name=nombre]');
await pagina.fill('input[name=fecha]', especial);
await pagina.fill('input[name=hora]', '18:30');
await pagina.fill('input[name=nombre]', 'Cena Temprana');
await pagina.fill('input[name=telefono]', '1155551212');
await pagina.click('button[type=submit]');
await pagina.waitForSelector('.aviso');
console.log('   18:30 ->', (await pagina.textContent('.aviso')).trim());

console.log('12. y ese día reemplaza el horario: a las 23:30 ya no hay servicio');
await pagina.goto('http://localhost:3000/panel/nueva');
await pagina.waitForSelector('input[name=nombre]');
await pagina.fill('input[name=fecha]', especial);
await pagina.fill('input[name=hora]', '23:30');
await pagina.fill('input[name=nombre]', 'Tarde');
await pagina.fill('input[name=telefono]', '1155551313');
await pagina.click('button[type=submit]');
await pagina.waitForSelector('.aviso');
console.log('   23:30 ->', (await pagina.textContent('.aviso')).trim());

console.log('13. el mismo día puede tener dos tandas');
await pagina.goto('http://localhost:3000/panel/horarios');
await pagina.waitForSelector('h1');
const alta2 = pagina.locator('form').filter({ hasText: 'Motivo' });
await alta2.locator('input[name=fecha]').fill(especial);
await alta2.locator('input[name=cerrado]').uncheck();
await alta2.locator('input[name=desde]').fill('11:00');
await alta2.locator('input[name=hasta]').fill('15:00');
await alta2.locator('input[name=motivo]').fill('Brunch');
await alta2.getByRole('button', { name: 'Agregar' }).click();
await pagina.waitForTimeout(1500);
const filaEspecial = pagina.locator('section').filter({ hasText: 'Días especiales' })
  .locator('tbody tr').filter({ hasText: especial });
console.log('   ese día dice:', (await filaEspecial.textContent()).replace(/\s+/g, ' ').trim());
await pagina.screenshot({ path: `${capturas}/horarios-3.png`, fullPage: true });

console.log('14. un día sin nada especial sigue aceptando');
// Autocontenido a propósito: los pasos de arriba se fueron a la pantalla de horarios,
// y dar por sentado en qué página quedó el navegador es cómo se rompen estos recorridos.
const normal = fechaLocal(4);
await pagina.goto('http://localhost:3000/panel/nueva');
await pagina.waitForSelector('input[name=nombre]');
await pagina.fill('input[name=fecha]', normal);
await pagina.fill('input[name=hora]', '21:00');
await pagina.fill('input[name=nombre]', 'Día Normal');
await pagina.fill('input[name=telefono]', '1155551414');
await pagina.click('button[type=submit]');
await pagina.waitForSelector('.aviso');
console.log('   ->', (await pagina.locator('.aviso').first().textContent()).trim());

console.log('\nerrores de consola:', errores.length === 0 ? 'ninguno' : errores);
await navegador.close();
