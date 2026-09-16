import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { poolAuth } from '../../../web/contexto';
import { origen } from '../../../web/origen';
import { localPorSlug } from '../../../servicios/publico';

/**
 * Lo que ve Google, y lo que se ve cuando alguien pega el link en WhatsApp.
 *
 * Todo apunta al LOCAL, no a la plataforma: el objetivo realista no es salir primero por
 * "restaurante", que compite con TripAdvisor y Google Maps, sino que cuando alguien
 * busca el nombre de este local aparezca su página de reservas.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const local = await localPorSlug(poolAuth(), slug);
  if (!local) return { title: 'Local no encontrado', robots: { index: false } };

  const url = `${await origen()}/r/${local.slug}`;
  const titulo = `${local.nombre} · Reservar mesa`;
  const descripcion =
    local.descripcion?.trim() ||
    `Reservá tu mesa en ${local.nombre}${local.direccion ? `, ${local.direccion}` : ''}. ` +
      'Sin registrarte y sin seña.';

  return {
    title: titulo,
    description: descripcion,
    alternates: { canonical: url },
    // Un local con la web apagada no tiene nada que ofrecer: que no se indexe hasta que
    // la prenda, o Google manda gente a una página que dice "llamá por teléfono".
    robots: local.webPublica ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      type: 'website',
      url,
      siteName: local.nombre,
      title: titulo,
      description: descripcion,
      locale: 'es_AR',
    },
    twitter: { card: 'summary', title: titulo, description: descripcion },
  };
}

export default async function LayoutPublico({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(await localPorSlug(poolAuth(), slug))) notFound();
  return children;
}
