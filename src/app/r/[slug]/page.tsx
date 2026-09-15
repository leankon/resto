import { notFound } from 'next/navigation';
import { poolAuth } from '../../../web/contexto';
import { localPorSlug } from '../../../servicios/publico';
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

  return (
    <main className="publico">
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
