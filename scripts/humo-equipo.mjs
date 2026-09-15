/**
 * Recorrido de humo sobre el equipo del local y los permisos por rol.
 *
 *   npm run db:demo && npm start   # en otra terminal
 *   npm run humo:equipo
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const capturas = process.env.CAPTURAS ?? '/tmp/capturas';
mkdirSync(capturas, { recursive: true });
const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errores = [];

const entrar = async (pagina, email, clave) => {
  await pagina.goto('http://localhost:3000/login');
  await pagina.fill('input[name=email]', email);
  await pagina.fill('input[name=password]', clave);
  await pagina.click('button[type=submit]');
  await pagina.waitForSelector('.marca');
};

const pagina = await navegador.newPage({ viewport: { width: 1180, height: 1000 } });
pagina.on('pageerror', (e) => errores.push(String(e)));
await entrar(pagina, 'duenio@bardemo.test', 'bar-demo-123');

console.log('1. el dueño ve el acceso al equipo');
console.log('   ->', await pagina.getByRole('link', { name: 'Equipo' }).count() > 0
  ? 'sí' : 'NO APARECE');
await pagina.getByRole('link', { name: 'Equipo' }).click();
await pagina.waitForSelector('h1');
console.log('   gente en el local:', await pagina.locator('tbody tr').count());

console.log('2. sumar un mozo');
const alta = pagina.locator('form').filter({ hasText: 'Contraseña inicial' });
const mail = `mozo-${Date.now()}@bardemo.test`;
await alta.locator('input[name=nombre]').fill('Rocío Mozo');
await alta.locator('input[name=email]').fill(mail);
await alta.locator('input[name=password]').fill('mozo-clave-123');
await alta.locator('select[name=rol]').selectOption('mozo');
await alta.getByRole('button', { name: 'Agregar' }).click();
await pagina.waitForTimeout(1600);
console.log('   ahora hay:', await pagina.locator('tbody tr').count());

console.log('3. no deja sumarlo dos veces');
await alta.locator('input[name=nombre]').fill('Rocío Mozo');
await alta.locator('input[name=email]').fill(mail);
await alta.locator('input[name=password]').fill('mozo-clave-123');
await alta.getByRole('button', { name: 'Agregar' }).click();
await pagina.waitForSelector('.aviso');
console.log('   ->', (await pagina.locator('.aviso').first().textContent()).trim());
await pagina.screenshot({ path: `${capturas}/equipo-1.png`, fullPage: true });

console.log('4. no deja dejar el local sin dueño');
const filaDuenio = pagina.locator('tbody tr').filter({ hasText: 'sos vos' });
await filaDuenio.locator('select[name=rol]').selectOption('mozo');
await filaDuenio.getByRole('button', { name: 'Cambiar' }).click();
await pagina.waitForTimeout(1600);
console.log('   ->', (await pagina.locator('.aviso').first().textContent()).trim());

console.log('5. el mozo entra pero no ve el equipo ni el salón');
const otra = await navegador.newPage({ viewport: { width: 1180, height: 1000 } });
otra.on('pageerror', (e) => errores.push(String(e)));
await entrar(otra, mail, 'mozo-clave-123');
console.log('   ve "Equipo":', await otra.getByRole('link', { name: 'Equipo' }).count() > 0);
console.log('   ve "El salón":', await otra.getByRole('link', { name: 'El salón' }).count() > 0);

console.log('6. y si escribe la dirección a mano, lo devuelve al panel');
for (const ruta of ['/panel/equipo', '/panel/salon', '/panel/horarios']) {
  await otra.goto(`http://localhost:3000${ruta}`);
  await otra.waitForTimeout(700);
  console.log(`   ${ruta} ->`, otra.url().endsWith('/panel') ? 'lo devuelve al panel' : `QUEDÓ EN ${otra.url()}`);
}

console.log('7. el mozo sí puede operar el día');
await otra.goto('http://localhost:3000/panel');
await otra.waitForSelector('tbody tr');
console.log('   ve la planilla con', await otra.locator('tbody tr').count(), 'reservas');

console.log('8. sacarlo del local le corta la sesión');
await pagina.reload();
await pagina.waitForSelector('h1');
const filaMozo = pagina.locator('tbody tr').filter({ hasText: 'Rocío Mozo' });
await filaMozo.getByRole('button', { name: 'Sacar del local' }).click();
await pagina.waitForTimeout(1600);
console.log('   gente en el local:', await pagina.locator('tbody tr').count());
await otra.goto('http://localhost:3000/panel');
await otra.waitForTimeout(900);
console.log('   ->', otra.url().includes('/login') ? 'lo manda al login' : `SIGUE ADENTRO: ${otra.url()}`);

console.log('\nerrores de consola:', errores.length === 0 ? 'ninguno' : errores);
await navegador.close();
