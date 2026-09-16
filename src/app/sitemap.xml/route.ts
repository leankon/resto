import { poolAuth } from '../../web/contexto';
import { origen } from '../../web/origen';
import { localesPublicados } from '../../servicios/publico';

/**
 * El mapa del sitio: la lista de páginas que vale la pena indexar.
 *
 * Solo los locales con la web prendida. Uno apagado muestra el teléfono en vez del
 * formulario, y mandarle gente desde Google a eso es gastar la visita.
 */
export async function GET(): Promise<Response> {
  const base = await origen();
  const locales = await localesPublicados(poolAuth());

  const urls = [
    { loc: `${base}/`, prioridad: '1.0', fecha: null as Date | null },
    ...locales.map((l) => ({
      loc: `${base}/r/${l.slug}`,
      prioridad: '0.9',
      fecha: l.actualizadoEn,
    })),
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) =>
      [
        '  <url>',
        `    <loc>${u.loc}</loc>`,
        u.fecha ? `    <lastmod>${u.fecha.toISOString().slice(0, 10)}</lastmod>` : '',
        `    <priority>${u.prioridad}</priority>`,
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    '</urlset>',
    '',
  ].join('\n');

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
