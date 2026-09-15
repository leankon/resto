/**
 * Recorrido de humo sobre la carga del salón.
 *
 *   npm run db:demo && npm start   # en otra terminal
 *   node scripts/humo-salon.mjs
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const capturas = process.env.CAPTURAS ?? '/tmp/capturas';
mkdirSync(capturas, { recursive: true });
const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pagina = await navegador.newPage({ viewport: { width: 1180, height: 1100 } });
const errores = [];
pagina.on('pageerror', (e) => errores.push(String(e)));

await pagina.goto('http://localhost:3000/login');
await pagina.fill('input[name=email]', 'duenio@bardemo.test');
await pagina.fill('input[name=password]', 'bar-demo-123');
await pagina.click('button[type=submit]');
await pagina.waitForSelector('.marca');

console.log('1. entrar al salón desde el panel');
await pagina.getByRole('link', { name: 'El salón' }).click();
await pagina.waitForSelector('.lienzo');
console.log('   salones:', (await pagina.locator('.solapas a').allTextContents())
  .map((s) => s.replace(/\s+/g, ' ').trim()).join(' | '));
console.log('   mesas dibujadas:', await pagina.locator('.ficha').count());
console.log('   uniones que el sistema puede armar:', await pagina.locator('.uniones line').count());
await pagina.screenshot({ path: `${capturas}/salon-1.png`, fullPage: true });

console.log('2. agregar un salón nuevo');
const formSalon = pagina.locator('form').filter({ hasText: 'Cómo se llama' });
await formSalon.locator('input[name=nombre]').fill('Patio');
await formSalon.getByRole('button', { name: 'Agregar', exact: true }).click();
await pagina.waitForTimeout(1200);
console.log('   ahora hay:', await pagina.locator('.solapas a').count(), 'salones');

console.log('3. agregar una mesa en el Patio');
await pagina.getByRole('link', { name: /Patio/ }).click();
await pagina.waitForSelector('input[name=capacidadBase]');
const alta = pagina.locator('form').filter({ has: pagina.locator('input[name=capacidadBase]') }).last();
await alta.locator('input[name=nombre]').fill('P1');
await alta.locator('input[name=capacidadBase]').fill('4');
await alta.locator('input[name=cabeceras]').fill('2');
await alta.getByRole('button', { name: 'Agregar mesa' }).click();
await pagina.waitForTimeout(1200);
console.log('   mesas en el Patio:', await pagina.locator('.ficha').count());

console.log('4. no deja repetir el nombre');
await alta.locator('input[name=nombre]').fill('P1');
await alta.getByRole('button', { name: 'Agregar mesa' }).click();
await pagina.waitForSelector('.aviso');
console.log('   ->', (await pagina.textContent('.aviso')).trim());

console.log('5. rechaza datos imposibles');
await alta.locator('input[name=nombre]').fill('P2');
await alta.locator('input[name=capacidadBase]').fill('4');
await alta.locator('input[name=capacidadMin]').fill('9');
await alta.getByRole('button', { name: 'Agregar mesa' }).click();
await pagina.waitForTimeout(1000);
console.log('   ->', (await pagina.textContent('.aviso')).trim());

console.log('6. arrastrar una mesa cambia su posición');
await alta.locator('input[name=capacidadMin]').fill('1');
await alta.locator('input[name=nombre]').fill('P2');
await alta.getByRole('button', { name: 'Agregar mesa' }).click();
// Esperar a que la mesa nueva esté dibujada: arrastrar mientras la página todavía se
// está rehaciendo agarra una ficha que React está por reemplazar.
await pagina.locator('.ficha').nth(1).waitFor();
await pagina.waitForTimeout(600);

const posiciones = () => pagina.locator('.editor-mesas td.apagado').allTextContents();
const antes = await posiciones();
const ficha = pagina.locator('.ficha').last();
// Sin esto la ficha puede quedar arriba del borde de la ventana y el clic cae al vacío.
await ficha.scrollIntoViewIfNeeded();
const caja = await ficha.boundingBox();
await pagina.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
await pagina.mouse.down();
await pagina.mouse.move(caja.x + 260, caja.y + 130, { steps: 12 });
await pagina.mouse.up();
await pagina.waitForTimeout(1800);
const despues = await posiciones();
console.log('   posiciones antes :', antes.map((s) => s.trim()).join(' | '));
console.log('   posiciones después:', despues.map((s) => s.trim()).join(' | '));
console.log('   ->', JSON.stringify(antes) !== JSON.stringify(despues)
  ? 'la tabla se actualizó sola, sin recargar'
  : 'LA TABLA NO SE ACTUALIZÓ (el dato puede estar guardado igual)');

console.log('7. las dos mesas del patio ahora se pueden unir');
await pagina.reload();
await pagina.waitForSelector('.lienzo');
const combinaciones = await pagina.locator('table tbody tr td strong').allTextContents();
console.log('   combinaciones listadas:', combinaciones.join(', ') || '(ninguna)');
console.log('   líneas en el plano:', await pagina.locator('.uniones line').count());
await pagina.screenshot({ path: `${capturas}/salon-2.png`, fullPage: true });

console.log('8. marcar que esas dos no se pueden unir');
const vetar = pagina.getByRole('button', { name: 'No se pueden unir' }).first();
if (await vetar.count() > 0) {
  await vetar.click();
  await pagina.waitForTimeout(1300);
  console.log('   líneas después de vetar:', await pagina.locator('.uniones line').count());
  await pagina.getByRole('button', { name: 'Permitir de nuevo' }).first().click();
  await pagina.waitForTimeout(1300);
  console.log('   líneas al permitirla de nuevo:', await pagina.locator('.uniones line').count());
}

console.log('9. una mesa con reservas no se puede borrar');
await pagina.goto('http://localhost:3000/panel/salon');
await pagina.waitForSelector('.lienzo');
const borrar = pagina.getByRole('button', { name: 'Borrar' });
const total = await borrar.count();
let bloqueadas = 0;
for (let i = 0; i < total; i++) if (await borrar.nth(i).isDisabled()) bloqueadas++;
console.log(`   ${bloqueadas} de ${total} mesas están protegidas por tener reservas`);

console.log('10. el enlace de plataforma está a la vista en el login');
await pagina.goto('http://localhost:3000/login');
console.log('   ->', await pagina.getByRole('link', { name: /plataforma/i }).count() > 0
  ? 'sí, se ve' : 'NO APARECE');

console.log('11. formas de mesa y tamaño del salón');
await pagina.goto('http://localhost:3000/panel/salon');
await pagina.waitForSelector('.lienzo');
console.log('   redondas:', await pagina.locator('.ficha.forma-redonda').count(),
            '| cuadradas:', await pagina.locator('.ficha.forma-cuadrada').count(),
            '| rectangulares:', await pagina.locator('.ficha.forma-rect').count());
console.log('   medidas:', (await pagina.locator('.lienzo + .apagado, .lienzo ~ p.apagado')
  .first().textContent()).replace(/\s+/g, ' ').trim().slice(0, 60));

console.log('12. agrandar el salón con el tirador de la esquina');
const antesMedida = await pagina.locator('.lienzo').boundingBox();
const tirador = pagina.locator('.tirador');
const cajaT = await tirador.boundingBox();
await pagina.mouse.move(cajaT.x + 10, cajaT.y + 10);
await pagina.mouse.down();
await pagina.mouse.move(cajaT.x + 10, cajaT.y + 220, { steps: 14 });
await pagina.mouse.up();
await pagina.waitForTimeout(1800);
const despuesMedida = await pagina.locator('.lienzo').boundingBox();
console.log(`   alto del plano: ${Math.round(antesMedida.height)} -> ${Math.round(despuesMedida.height)} px`);
console.log('   ->', despuesMedida.height > antesMedida.height + 50
  ? 'el salón quedó más grande y se guardó' : 'NO SE AGRANDÓ');
await pagina.screenshot({ path: `${capturas}/salon-3.png`, fullPage: true });

console.log('13. una mesa no se puede arrastrar fuera del salón');
const f = pagina.locator('.ficha').first();
const cf = await f.boundingBox();
const lienzo = await pagina.locator('.lienzo').boundingBox();
await pagina.mouse.move(cf.x + cf.width / 2, cf.y + cf.height / 2);
await pagina.mouse.down();
await pagina.mouse.move(lienzo.x + lienzo.width + 400, lienzo.y + lienzo.height + 400, { steps: 14 });
await pagina.mouse.up();
await pagina.waitForTimeout(1800);
const fin = await pagina.locator('.ficha').first().boundingBox();
console.log('   ->', fin.x + fin.width <= lienzo.x + lienzo.width + 2
  ? 'la mesa quedó adentro del salón' : 'SE FUE AFUERA');

console.log('\nerrores de consola:', errores.length === 0 ? 'ninguno' : errores);
await navegador.close();
