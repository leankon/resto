import { origen } from '../../web/origen';

/**
 * Qué puede recorrer un buscador.
 *
 * Las páginas de los locales, sí: son el producto de cara al público. El panel, el
 * widget y la reserva de cada cliente, no. El widget porque duplicaría el contenido de
 * la página del local, y Google castiga eso; la reserva porque su URL lleva el token que
 * la abre —indexarla la publicaría.
 */
export async function GET(): Promise<Response> {
  const base = await origen();
  const texto = [
    'User-agent: *',
    'Allow: /r/',
    'Disallow: /panel',
    'Disallow: /admin',
    'Disallow: /login',
    'Disallow: /elegir-local',
    'Disallow: /r/*/widget',
    'Disallow: /r/*/reserva/',
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');

  return new Response(texto, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
