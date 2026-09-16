/**
 * Recorrido de humo sobre lo que ve Google y lo que se ve al pegar un link en WhatsApp.
 *
 *   npm run db:demo && npm start   # en otra terminal
 *   npm run humo:google
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const fallas = [];
const revisar = (condicion, que) => {
  console.log(`   ${condicion ? '✓' : '✗'} ${que}`);
  if (!condicion) fallas.push(que);
};

const pagina = await navegador.newPage({ viewport: { width: 1100, height: 900 } });
const meta = (sel) => pagina.locator(sel).first().getAttribute('content');

console.log('1. la portada de la plataforma se ve sin sesión');
await pagina.goto(`${BASE}/`);
await pagina.waitForSelector('h1');
revisar(pagina.url().endsWith('/'), 'no rebota al login');
revisar((await pagina.title()).startsWith('resto'), `título: ${await pagina.title()}`);
revisar((await meta('meta[name=description]')).length > 60, 'tiene descripción para el buscador');
revisar((await meta('meta[property="og:title"]')) !== null, 'tiene Open Graph');

console.log('2. quien ya tiene sesión entra directo al panel');
await pagina.goto(`${BASE}/login`);
await pagina.fill('input[name=email]', 'duenio@bardemo.test');
await pagina.fill('input[name=password]', 'bar-demo-123');
await pagina.click('button[type=submit]');
await pagina.waitForSelector('.marca');
await pagina.goto(`${BASE}/`);
await pagina.waitForURL(/\/panel/, { timeout: 8000 }).catch(() => {});
revisar(pagina.url().includes('/panel'), 'la portada lo manda al panel');

console.log('3. robots.txt deja pasar a los locales y no al panel');
const robots = await (await pagina.request.get(`${BASE}/robots.txt`)).text();
revisar(robots.includes('Allow: /r/'), 'deja indexar las páginas de los locales');
revisar(robots.includes('Disallow: /panel'), 'no deja indexar el panel');
// La URL de la reserva ES la credencial del cliente: indexarla sería publicarla.
revisar(robots.includes('Disallow: /r/*/reserva/'), 'no deja indexar la reserva de nadie');
revisar(robots.includes('/sitemap.xml'), 'apunta al mapa del sitio');

console.log('4. el sitemap lista los locales con la web prendida');
let mapa = await (await pagina.request.get(`${BASE}/sitemap.xml`)).text();
revisar(mapa.includes('/r/bar-demo'), 'está el local de demo');

console.log('5. y deja afuera al que la tiene apagada');
await pagina.goto(`${BASE}/panel/publico`);
await pagina.waitForSelector('h1');
await pagina.locator('input[name=webPublica]').uncheck();
await pagina.locator('form').filter({ hasText: 'Tomar reservas por internet' })
  .getByRole('button', { name: 'Guardar' }).click();
await pagina.waitForTimeout(1600);
mapa = await (await pagina.request.get(`${BASE}/sitemap.xml`)).text();
revisar(!mapa.includes('/r/bar-demo'), 'el local apagado ya no figura');

console.log('6. y su página pide no ser indexada');
const sinSesion = await navegador.newPage();
await sinSesion.goto(`${BASE}/r/bar-demo`);
const robotsMeta = await sinSesion.locator('meta[name=robots]').first().getAttribute('content');
revisar((robotsMeta ?? '').includes('noindex'), `meta robots: ${robotsMeta}`);

console.log('7. con la web prendida, la página trae todo lo que Google necesita');
await pagina.locator('input[name=webPublica]').check();
await pagina.locator('form').filter({ hasText: 'Tomar reservas por internet' })
  .getByRole('button', { name: 'Guardar' }).click();
await pagina.waitForTimeout(1600);

await sinSesion.goto(`${BASE}/r/bar-demo`);
await sinSesion.waitForSelector('h1');
const titulo = await sinSesion.title();
revisar(titulo.includes('Bar Demo'), `título con el nombre del local: ${titulo}`);
const canonico = await sinSesion.locator('link[rel=canonical]').first().getAttribute('href');
revisar((canonico ?? '').endsWith('/r/bar-demo'), `canónico: ${canonico}`);
const ogTitulo = await sinSesion.locator('meta[property="og:title"]').first().getAttribute('content');
revisar((ogTitulo ?? '').includes('Bar Demo'), 'el link se ve bien al pegarlo en WhatsApp');

const ld = JSON.parse(
  await sinSesion.locator('script[type="application/ld+json"]').first().textContent(),
);
revisar(ld['@type'] === 'Restaurant', 'se declara como restaurante');
revisar(ld.address?.streetAddress === 'Av. Siempreviva 742', 'con su dirección');
revisar(ld.telephone === '11 4567-8900', 'con su teléfono');
revisar((ld.openingHoursSpecification ?? []).length > 0, 'con su horario de apertura');
revisar(ld.potentialAction?.['@type'] === 'ReserveAction', 'y con la acción de reservar');
revisar(ld.acceptsReservations === true, 'declarando que toma reservas');

console.log(fallas.length ? `\nFALLAS: ${fallas.length}` : '\ntodo bien');
await navegador.close();
process.exit(fallas.length ? 1 : 0);
