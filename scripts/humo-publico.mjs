/**
 * Recorrido de humo sobre la web pública de reservas: el camino que hace alguien de
 * la calle, sin cuenta y sin haber entrado nunca al panel.
 *
 *   npm run db:demo && npm start   # en otra terminal
 *   npm run humo:publico
 */
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
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

// --- El dueño prende la web pública ---
const panel = await navegador.newPage({ viewport: { width: 1180, height: 1000 } });
panel.on('pageerror', (e) => errores.push(`panel: ${e}`));
await panel.goto(`${BASE}/login`);
await panel.fill('input[name=email]', 'duenio@bardemo.test');
await panel.fill('input[name=password]', 'bar-demo-123');
await panel.click('button[type=submit]');
await panel.waitForSelector('.marca');

console.log('1. el dueño abre la pantalla de reservas web');
await panel.getByRole('link', { name: 'Reservas web' }).first().click();
await panel.waitForSelector('h1');
const link = (await panel.locator('.snippet').first().textContent()).trim();
const snippet = (await panel.locator('.snippet').nth(1).textContent()).trim();
revisar(link.includes('/r/'), `el link del local es ${link}`);
revisar(snippet.includes('embed.js'), 'hay un código para pegar en la web del local');

console.log('2. prende la página y pone los datos del local');
const ajustes = panel.locator('form').filter({ hasText: 'Tomar reservas por internet' });
await ajustes.locator('input[name=webPublica]').check();
await ajustes.locator('input[name=direccion]').fill('Av. Siempreviva 742');
await ajustes.locator('input[name=telefonoPublico]').fill('11 4567-8900');
await ajustes.locator('textarea[name=mensajeConfirmacion]').fill('Te guardamos la mesa 15 minutos.');
await ajustes.getByRole('button', { name: 'Guardar' }).click();
await panel.waitForTimeout(1500);
revisar(await ajustes.locator('input[name=webPublica]').isChecked(), 'quedó prendida');
await panel.screenshot({ path: `${capturas}/publico-panel.png`, fullPage: true });

// --- Alguien de la calle entra a reservar ---
const cliente = await navegador.newPage({ viewport: { width: 420, height: 900 } });
cliente.on('pageerror', (e) => errores.push(`cliente: ${e}`));

console.log('3. entra al link sin sesión y ve el local');
await cliente.goto(link);
await cliente.waitForSelector('h1');
revisar((await cliente.locator('h1').textContent()).includes('Bar'), 've el nombre del local');
revisar(await cliente.locator('.portada .datos').textContent() !== '', 've dirección y teléfono');

console.log('4. elige día y cantidad');
const enTresDias = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
await cliente.fill('input[name=fecha]', enTresDias);
await cliente.selectOption('select[name=personas]', '4');
await cliente.getByRole('button', { name: 'Ver horarios' }).click();
await cliente.waitForSelector('.horarios');
const horarios = await cliente.locator('.horarios a').count();
revisar(horarios > 0, `hay ${horarios} horarios con lugar`);
await cliente.screenshot({ path: `${capturas}/publico-horarios.png`, fullPage: true });

console.log('5. elige una hora y deja sus datos');
await cliente.locator('.horarios a').filter({ hasText: '21:00' }).first().click();
await cliente.waitForSelector('input[name=nombre]');
await cliente.fill('input[name=nombre]', 'Marta de la Calle');
await cliente.fill('input[name=telefono]', '11 5555-4444');
await cliente.fill('textarea[name=notas]', 'Somos celíacos');
await cliente.screenshot({ path: `${capturas}/publico-datos.png`, fullPage: true });
await cliente.getByRole('button', { name: 'Confirmar reserva' }).click();
await cliente.waitForURL(/\/reserva\//, { timeout: 15000 });

console.log('6. queda confirmada, con link propio y sin haberse registrado');
const confirmacion = await cliente.locator('.tarjeta').first().textContent();
revisar(confirmacion.includes('te esperamos'), 'le confirma la reserva');
revisar(confirmacion.includes('Marta de la Calle'), 'a su nombre');
revisar(confirmacion.includes('Te guardamos la mesa'), 'con el mensaje que puso el local');
const linkDeLaReserva = cliente.url();
await cliente.screenshot({ path: `${capturas}/publico-confirmada.png`, fullPage: true });

console.log('7. la reserva aparece en la planilla del día del local');
await panel.goto(`${BASE}/panel?fecha=${enTresDias}`);
await panel.waitForSelector('table');
const fila = panel.locator('tbody tr').filter({ hasText: 'Marta de la Calle' });
revisar((await fila.count()) > 0, 'el local la ve en su planilla');
revisar((await fila.first().textContent()).includes('Web'), 'marcada como reserva de la web');
revisar((await fila.first().textContent()).includes('Somos celíacos'), 'con lo que avisó');

console.log('8. vuelve a su reserva con el link y la cancela');
await cliente.goto(linkDeLaReserva);
await cliente.getByRole('button', { name: 'No voy a poder ir' }).click();
await cliente.getByRole('button', { name: 'Sí, cancelar la reserva' }).click();
await cliente.waitForTimeout(1800);
revisar(
  (await cliente.locator('h2').first().textContent()).includes('cancelada'),
  'queda cancelada desde su propio link',
);

console.log('9. el local ve la cancelación y la mesa quedó libre');
await panel.goto(`${BASE}/panel?fecha=${enTresDias}`);
await panel.waitForSelector('table');
const filaCancelada = panel.locator('tbody tr').filter({ hasText: 'Marta de la Calle' });
revisar(
  (await filaCancelada.first().textContent()).includes('Cancelada'),
  'el panel la muestra cancelada',
);

console.log('10. el widget se puede embeber desde otro dominio');
const anfitrion = await navegador.newPage({ viewport: { width: 900, height: 900 } });
anfitrion.on('pageerror', (e) => errores.push(`anfitrion: ${e}`));
// Servido desde un origen http de verdad, y no con setContent: una página
// `about:blank` no tiene esquema de red, así que ningún navegador la deja embeber
// nada y el test pasaría o fallaría por el motivo equivocado.
const anfitrionHttp = createServer((_pedido, respuesta) => {
  respuesta.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  respuesta.end(`<!doctype html><html><body style="font:16px system-ui;padding:24px">
     <h1>La web del restaurante</h1>${snippet}</body></html>`);
});
await new Promise((listo) => anfitrionHttp.listen(3100, listo));
await anfitrion.goto('http://127.0.0.1:3100/', { waitUntil: 'networkidle' });
await anfitrion.waitForTimeout(2500);
const marco = anfitrion.frameLocator('iframe');
revisar((await anfitrion.locator('iframe').count()) === 1, 'el script insertó el recuadro');
revisar(
  (await marco.locator('button:has-text("Ver horarios")').count()) > 0,
  'adentro del recuadro se puede reservar',
);
// Que el alto crezca al abrir el formulario es el punto: un iframe no se ajusta
// solo, y sin esto elegir un horario deja el paso 3 con scroll adentro del recuadro.
const altoDe = () =>
  anfitrion.locator('iframe').evaluate((e) => e.getBoundingClientRect().height);
const altoInicial = await altoDe();
await marco.locator('.horarios a').first().click();
await marco.locator('input[name=nombre]').waitFor();
await anfitrion.waitForTimeout(1200);
const altoConFormulario = await altoDe();
revisar(
  altoConFormulario > altoInicial,
  `el recuadro creció al abrirse el formulario (${Math.round(altoInicial)} → ${Math.round(altoConFormulario)}px)`,
);
await anfitrion.screenshot({ path: `${capturas}/publico-widget.png`, fullPage: true });

console.log('11. el panel no se puede meter en un iframe');
const cabeceras = await panel.request.get(`${BASE}/panel`);
revisar(cabeceras.headers()['x-frame-options'] === 'DENY', 'el panel rechaza el iframe');

console.log(errores.length ? `\nerrores de JS: ${errores.join(' | ')}` : '\nsin errores de JS');
console.log(fallas.length ? `FALLAS: ${fallas.length}` : 'todo bien');
await navegador.close();
anfitrionHttp.close();
process.exit(fallas.length ? 1 : 0);
