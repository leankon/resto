import Link from 'next/link';
import { requerirStaff } from '../../../web/contexto';
import { hoyEn } from '../../../web/formato';
import Formulario from './formulario';

export default async function NuevaReserva({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const { fecha } = await searchParams;
  const ctx = await requerirStaff();
  const porDefecto = /^\d{4}-\d{2}-\d{2}$/.test(fecha ?? '') ? fecha! : hoyEn(ctx.tenant.tz);

  return (
    <>
      <header className="barra">
        <span className="marca">{ctx.tenant.nombre}</span>
        <Link className="boton secundario chico" href={`/panel?fecha=${porDefecto}`}>
          Volver al día
        </Link>
      </header>
      <main className="contenido angosto">
        <h1 style={{ fontSize: 20, margin: '4px 0 18px' }}>Nueva reserva</h1>
        <Formulario fecha={porDefecto} />
      </main>
    </>
  );
}
