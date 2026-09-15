import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { poolAuth } from '../../../web/contexto';
import { localPorSlug } from '../../../servicios/publico';

/** El título de la pestaña y lo que se ve al compartir el link son del local, no nuestros. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const local = await localPorSlug(poolAuth(), slug);
  if (!local) return { title: 'Local no encontrado' };
  return {
    title: `Reservar en ${local.nombre}`,
    description: local.descripcion ?? `Reservá tu mesa en ${local.nombre}.`,
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
