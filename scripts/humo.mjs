/**
 * Recorrido de humo sobre el panel andando de verdad.
 *
 *   npm run db:demo && npm start   # en otra terminal
 *   npm run humo
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const capturas = process.env.CAPTURAS ?? '/tmp/capturas';
mkdirSync(capturas, { recursive: true });
const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pagina = await navegador.newPage({ viewport: { width: 1180, height: 1000 } });
const errores = [];
pagina.on('pageerror', (e) => errores.push(String(e)));

const foto = async (nombre) => {
  await pagina.screenshot({ path: `${capturas}/${nombre}.png`, fullPage: true });
};

console.log('1. login con contraseña incorrecta');
await pagina.goto('http://localhost:3000/login');
await pagina.fill('input[name=email]', 'duenio@bardemo.test');
await pagina.fill('input[name=password]', 'equivocada');
await pagina.click('button[type=submit]');
await pagina.waitForSelector('.aviso');
console.log('   ->', await pagina.textContent('.aviso'));

console.log('2. login correcto');
await pagina.fill('input[name=password]', 'bar-demo-123');
await pagina.click('button[type=submit]');
await pagina.waitForSelector('.marca');
console.log('   local:', await pagina.textContent('.marca'));
console.log('   resumen:', (await pagina.locator('.apagado').first().textContent()).trim());
console.log('   reservas:', await pagina.locator('tbody tr').count());
await foto('01-panel-del-dia');

console.log('3. marcar que llegó el primero');
const primera = pagina.locator('tbody tr').first();
const quien = (await primera.locator('td').nth(1).textContent()).trim();
await primera.getByRole('button', { name: 'Llegó' }).click();
await pagina.waitForTimeout(1200);
console.log(`   ${quien} ->`, (await pagina.locator('tbody tr').first().locator('.pastilla').first().textContent()).trim());

console.log('4. solapa Terraza');
await pagina.getByRole('link', { name: 'Terraza' }).click();
await pagina.waitForTimeout(900);
console.log('   mesas:', (await pagina.locator('.mesa .nombre').allTextContents()).join(', '));

console.log('5. nueva reserva: grupo que no entra');
await pagina.getByRole('link', { name: 'Nueva reserva' }).click();
await pagina.waitForSelector('input[name=nombre]');
await pagina.fill('input[name=nombre]', 'Grupo Enorme');
await pagina.fill('input[name=telefono]', '1122223333');
await pagina.fill('input[name=personas]', '25');
await pagina.selectOption('select[name=hora]', '21:00');
await pagina.click('button[type=submit]');
await pagina.waitForSelector('.aviso');
console.log('   ->', (await pagina.textContent('.aviso')).replace(/\s+/g, ' ').trim());

console.log('6. nueva reserva: local cerrado');
await pagina.fill('input[name=personas]', '2');
await pagina.selectOption('select[name=hora]', '18:00');
await pagina.click('button[type=submit]');
await pagina.waitForTimeout(1200);
console.log('   ->', (await pagina.textContent('.aviso')).replace(/\s+/g, ' ').trim());

console.log('7. nueva reserva sin contacto');
await pagina.fill('input[name=telefono]', '');
await pagina.selectOption('select[name=hora]', '21:45');
await pagina.click('button[type=submit]');
await pagina.waitForTimeout(1200);
console.log('   ->', (await pagina.textContent('.aviso')).replace(/\s+/g, ' ').trim());

console.log('8. nueva reserva que entra');
await pagina.fill('input[name=nombre]', 'Pareja Nueva');
await pagina.fill('input[name=telefono]', '011 15 8888-7777');
await pagina.click('button[type=submit]');
await pagina.waitForSelector('.aviso.ok');
console.log('   ->', (await pagina.textContent('.aviso.ok')).replace(/\s+/g, ' ').trim());
await foto('02-nueva-reserva');

console.log('9. la misma persona vuelve a reservar con el teléfono tipeado distinto');
await pagina.fill('input[name=nombre]', 'Pareja Nueva');
await pagina.fill('input[name=telefono]', '1188887777');
await pagina.selectOption('select[name=hora]', '13:00');
await pagina.click('button[type=submit]');
await pagina.waitForTimeout(1500);
console.log('   ->', (await pagina.textContent('.aviso.ok')).replace(/\s+/g, ' ').trim());

console.log('10. detalle e historial');
await pagina.goto('http://localhost:3000/panel');
await pagina.waitForSelector('tbody tr a');
await pagina.locator('tbody tr a').first().click();
await pagina.waitForSelector('select[name=mesaId]');
await foto('03-detalle-reserva');

console.log('11. moverla de mesa');
const libres = await pagina.locator('select[name=mesaId] option:not([disabled])').all();
const destino = await libres[libres.length - 1].getAttribute('value');
await pagina.selectOption('select[name=mesaId]', destino);
await pagina.fill('input[name=motivo]', 'pidió la ventana');
await pagina.getByRole('button', { name: 'Mover' }).click();
await pagina.waitForTimeout(1500);
for (const fila of await pagina.locator('section').last().locator('tbody tr').allTextContents()) {
  console.log('   ', fila.replace(/\s+/g, ' ').trim());
}
await foto('04-historial');

console.log('12. panel de plataforma');
await pagina.goto('http://localhost:3000/admin/login');
await pagina.fill('input[name=email]', 'admin@plataforma.test');
await pagina.fill('input[name=password]', 'plataforma-123');
await pagina.click('button[type=submit]');
await pagina.waitForSelector('table');
console.log('   ->', await pagina.locator('h2').first().textContent());
console.log('   ->', (await pagina.locator('tbody tr').first().textContent()).replace(/\s+/g, ' ').trim());
await foto('05-plataforma');

console.log('13. el panel de plataforma no se abre con sesión de staff');
await pagina.goto('http://localhost:3000/login');
await pagina.fill('input[name=email]', 'duenio@bardemo.test');
await pagina.fill('input[name=password]', 'bar-demo-123');
await pagina.click('button[type=submit]');
await pagina.waitForSelector('.marca');
await pagina.goto('http://localhost:3000/admin');
await pagina.waitForTimeout(800);
console.log('   ->', pagina.url().endsWith('/admin/login') ? 'lo manda al login de plataforma' : `NO REDIRIGIÓ: ${pagina.url()}`);

console.log('\nerrores de consola:', errores.length === 0 ? 'ninguno' : errores);
await navegador.close();
