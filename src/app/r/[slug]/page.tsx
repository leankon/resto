import { notFound } from 'next/navigation';
import { poolAuth } from '../../../web/contexto';
import { datosParaGoogle, localPorSlug } from '../../../servicios/publico';
import { poolApp } from '../../../web/contexto';
import { origen } from '../../../web/origen';
import ReservasPublicas, { type Parametros } from './reservas-publicas';

export default async function PaginaDelLocal({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Parametros>;
}) {
  const { slug } = await params;
  const local = await localPorSlug(poolAuth(), slug);
  if (!local) notFound();

  const url = `${await origen()}/r/${local.slug}`;
  const paraGoogle = await datosParaGoogle(poolApp(), local, url);

  return (
    <main className="publico">
      {/* Lo que hace que, buscando el nombre del local, Google muestre su horario y un
          acceso a reservar en vez de un link pelado. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(paraGoogle) }}
      />
      <header className="portada">
        <h1>{local.nombre}</h1>
        <p className="datos">
          {local.direccion && <span>{local.direccion}</span>}
          {local.telefonoPublico && <span>{local.telefonoPublico}</span>}
        </p>
        {local.descripcion && <p className="descripcion">{local.descripcion}</p>}
      </header>

      <ReservasPublicas local={local} parametros={await searchParams} canal="web" />

      <p className="pie">Reservas gestionadas con resto</p>
    </main>
  );
}
