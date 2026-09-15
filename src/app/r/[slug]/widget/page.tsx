import { notFound } from 'next/navigation';
import { poolAuth } from '../../../../web/contexto';
import { localPorSlug } from '../../../../servicios/publico';
import ReservasPublicas, { type Parametros } from '../reservas-publicas';
import AltoAlPadre from './alto';

/**
 * La misma reserva, para meter dentro de la web del local.
 *
 * Sin portada ni pie: el nombre y la dirección ya están en la página que la contiene,
 * repetirlos adentro del recuadro se ve como un error.
 */
export default async function Widget({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Parametros>;
}) {
  const { slug } = await params;
  const local = await localPorSlug(poolAuth(), slug);
  if (!local) notFound();

  return (
    <main className="publico compacto">
      <ReservasPublicas
        local={local}
        parametros={await searchParams}
        canal="widget"
        compacto
      />
      <AltoAlPadre />
    </main>
  );
}
