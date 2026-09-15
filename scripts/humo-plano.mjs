/**
 * Recorrido de humo sobre el salón en vivo: mover una reserva de mesa desde el plano.
 *
 *   npm run db:demo && npm start   # en otra terminal
 *   npm run humo:plano
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const capturas = process.env.CAPTURAS ?? '/tmp/capturas';
const BASE = process.env.BASE ?? 'http://localhost:3000';
mkdirSync(capturas, { recursive: true });
const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errores = [];
const fallas = [];
const revisar = (condicion, que) => {
  console.log(`   ${condicion ? '✓' : '✗'} ${que}`);
  if (!condicion) fallas.push(que);
};

const pagina = await navegador.newPage({ viewport: { width: 1180, height: 1100 } });
/** La ficha de una mesa por su nombre exacto: `hasText: '1'` también matchea la 10. */
const ficha = (nombre) =>
  pagina.locator('.plano-vivo .ficha').filter({ has: pagina.locator(`span:text-is("${nombre}")`) });
pagina.on('pageerror', (e) => errores.push(String(e)));
await pagina.goto(`${BASE}/login`);
await pagina.fill('input[name=email]', 'duenio@bardemo.test');
await pagina.fill('input[name=password]', 'bar-demo-123');
await pagina.click('button[type=submit]');
await pagina.waitForSelector('.marca');

const hoy = new Date().toISOString().slice(0, 10);

console.log('1. el salón se ve como plano, no como lista');
// Con hora explícita: la que se muestra por defecto depende del reloj del local.
await pagina.goto(`${BASE}/panel?fecha=${hoy}&hora=21:00`);
await pagina.waitForSelector('.plano-vivo');
const mesas = await pagina.locator('.plano-vivo .ficha').count();
revisar(mesas > 0, `${mesas} mesas dibujadas`);
const ocupadas = await pagina.locator('.plano-vivo .ficha.esperando, .plano-vivo .ficha.sentada').count();
revisar(ocupadas > 0, `${ocupadas} ocupadas a las 21:00`);
await pagina.screenshot({ path: `${capturas}/plano-1.png`, fullPage: true });

console.log('2. tocar una mesa ocupada muestra de quién es');
const ocupada = pagina.locator('.plano-vivo .ficha.esperando, .plano-vivo .ficha.sentada').first();
const nombreOcupada = (await ocupada.locator('span').textContent()).trim();
await ocupada.click();
await pagina.waitForSelector('.mover');
const cartel = (await pagina.locator('.mover').textContent()).trim();
const quienEs = (await pagina.locator('.mover strong').textContent()).trim();
console.log(`   reserva de ${quienEs}, hoy en la mesa ${nombreOcupada}`);
revisar(/Tocá (una de las \d+ mesas|la mesa) marcada/.test(cartel), 'pide destino antes de dejar mover');
revisar(
  await pagina.locator('.mover button:has-text("Mover")').isDisabled(),
  'el botón de mover arranca apagado',
);

console.log('3. solo se ofrecen las mesas libres durante todo el turno');
const sirven = pagina.locator('.plano-vivo .ficha.posible');
const noSirven = pagina.locator('.plano-vivo .ficha.nolesirve');
const cuantasSirven = await sirven.count();
revisar(cuantasSirven > 0, `${cuantasSirven} mesas aguantan el turno entero`);
revisar(
  (await noSirven.count()) > 0,
  `${await noSirven.count()} libres ahora pero tomadas antes de que termine, marcadas aparte`,
);
// Que estén apagadas no alcanza: tocarlas no tiene que hacer nada.
const inservible = noSirven.first();
const nombreInservible = (await inservible.locator('span').textContent()).trim();
await inservible.click();
revisar(
  !(await pagina.locator('.mover').textContent()).includes('Va a pasar a'),
  `tocar la mesa ${nombreInservible} no la elige como destino`,
);

console.log('4. tocar una que sí sirve la marca como destino');
const libre = sirven.first();
const nombreLibre = (await libre.locator('span').textContent()).trim();
await libre.click();
revisar(
  (await pagina.locator('.mover').textContent()).includes(`Va a pasar a ${nombreLibre}`),
  `de la mesa ${nombreOcupada} a la ${nombreLibre}`,
);
await pagina.screenshot({ path: `${capturas}/plano-2.png`, fullPage: true });

console.log('5. mover de verdad');
await pagina.locator('.mover button:has-text("Mover")').click();
await pagina.waitForTimeout(2200);
revisar(
  !(await ficha(nombreLibre).getAttribute('class')).includes('libre'),
  `la mesa ${nombreLibre} ahora está ocupada`,
);
revisar(
  (await ficha(nombreOcupada).getAttribute('class')).includes('libre'),
  `la mesa ${nombreOcupada} quedó libre`,
);
await pagina.screenshot({ path: `${capturas}/plano-3.png`, fullPage: true });

console.log('6. la planilla del día refleja el cambio');
const filaDeLaReserva = pagina.locator('tbody tr').filter({ hasText: quienEs });
revisar(
  (await filaDeLaReserva.locator('td').nth(3).textContent()).trim() === nombreLibre,
  `la planilla la muestra en la mesa ${nombreLibre}`,
);

console.log('7. las horas del plano salen del horario del local');
const opciones = await pagina.locator('.reloj select[name=hora] option').allTextContents();
revisar(opciones.includes('12:00'), 'ofrece el almuerzo');
revisar(opciones.includes('20:00'), 'ofrece la apertura de la cena');
// El bar cierra a las 02:00: a la 01:00 todavía hay gente sentada y hay que poder verla.
revisar(opciones.includes('01:00'), 'ofrece la madrugada, que es cuando el local cierra');
revisar(opciones.includes('21:15'), 'va de cuarto en cuarto de hora');
revisar(
  opciones.every((h) => ['00', '15', '30', '45'].includes(h.slice(3))),
  'no deja caer en una hora suelta tipo 23:01',
);
// La madrugada va al final: es cuando pasa, no antes del mediodía.
revisar(opciones.at(-1) === '02:00', 'la madrugada queda al final de la lista');

console.log('8. las flechas se mueven de a un cuarto de hora');
const horaActual = await pagina.locator('.reloj select[name=hora]').inputValue();
await pagina.locator('.reloj a[aria-label="Un cuarto de hora después"]').click();
// Esperar el plano no alcanza: ya está en pantalla, así que el chequeo pasaría antes
// de que la navegación termine y leería el valor viejo.
await pagina.waitForURL(/hora=21%3A15/, { timeout: 8000 }).catch(() => {});
const horaSiguiente = await pagina.locator('.reloj select[name=hora]').inputValue();
revisar(horaSiguiente === '21:15', `de ${horaActual} pasó a ${horaSiguiente}`);

console.log('9. una reserva tardía se ve en el plano a su hora');
// Antes las horas del plano eran una lista fija que terminaba a las 23:00: una reserva
// de las 23:30 figuraba en la planilla y no aparecía en el salón por ningún lado.
await pagina.goto(`${BASE}/panel/nueva?fecha=${hoy}`);
await pagina.fill('input[name=hora]', '23:30');
await pagina.fill('input[name=personas]', '2');
await pagina.fill('input[name=nombre]', 'Trasnochador');
await pagina.fill('input[name=telefono]', '11 3333 2222');
await pagina.getByRole('button', { name: 'Reservar' }).click();
// El alta de mostrador no navega: contesta ahí mismo con la mesa que asignó.
await pagina.waitForSelector('.aviso.ok', { timeout: 15000 });
console.log('   ->', (await pagina.locator('.aviso.ok').textContent()).trim());

await pagina.goto(`${BASE}/panel?fecha=${hoy}&hora=23:30`);
await pagina.waitForSelector('.plano-vivo');
const ocupadasTarde = await pagina
  .locator('.plano-vivo .ficha.esperando, .plano-vivo .ficha.sentada')
  .count();
revisar(ocupadasTarde > 0, 'a las 23:30 se ve la mesa de la reserva de las 23:30');
const marcada = await pagina.locator('.reloj select[name=hora]').inputValue();
revisar(marcada === '23:30', 'la hora que se está mirando queda seleccionada');
await pagina.screenshot({ path: `${capturas}/plano-4.png`, fullPage: true });

console.log('10. queda el rastro de quién la movió');
await pagina.goto(`${BASE}/panel?fecha=${hoy}&hora=21:00`);
await pagina.waitForSelector('tbody tr');
await pagina.locator('tbody tr').filter({ hasText: quienEs }).first().locator('a').click();
await pagina.waitForSelector('h1');
const historial = await pagina.locator('main').textContent();
revisar(
  historial.includes('Marta Dueña') && historial.includes(nombreOcupada),
  'el historial dice quién la movió y de qué mesa salió',
);

console.log(errores.length ? `\nerrores de JS: ${errores.join(' | ')}` : '\nsin errores de JS');
console.log(fallas.length ? `FALLAS: ${fallas.length}` : 'todo bien');
await navegador.close();
process.exit(fallas.length ? 1 : 0);
