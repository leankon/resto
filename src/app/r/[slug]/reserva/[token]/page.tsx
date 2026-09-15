import VistaReserva from '../../vista-reserva';

export default async function Reserva({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  return <VistaReserva slug={slug} token={token} />;
}
