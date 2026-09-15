import VistaReserva from '../../../vista-reserva';
import AltoAlPadre from '../../alto';

export default async function ReservaEnWidget({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  return (
    <>
      <VistaReserva slug={slug} token={token} compacto />
      <AltoAlPadre />
    </>
  );
}
