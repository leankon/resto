import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sesion } from '../web/contexto';
import { origen } from '../web/origen';

export async function generateMetadata(): Promise<Metadata> {
  const url = await origen();
  const descripcion =
    'Reservas para restaurantes: página propia, mesas asignadas solas y un panel para ' +
    'el turno. El comensal reserva sin registrarse y sin dejar seña.';

  return {
    title: 'resto · Reservas para restaurantes',
    description: descripcion,
    alternates: { canonical: `${url}/` },
    openGraph: {
      type: 'website',
      url: `${url}/`,
      siteName: 'resto',
      title: 'resto · Reservas para restaurantes',
      description: descripcion,
      locale: 'es_AR',
    },
    twitter: { card: 'summary', title: 'resto', description: descripcion },
  };
}

const QUE_HACE = [
  {
    titulo: 'La mesa la elige el sistema',
    texto:
      'Cargás el plano una vez —dónde está cada mesa, cuánta gente sienta, cuáles se ' +
      'pueden unir— y el motor reparte. Junta dos mesas cuando hace falta y no le da ' +
      'la de ocho a una pareja si hay algo mejor.',
  },
  {
    titulo: 'Tu página de reservas',
    texto:
      'Cada local tiene la suya, con su nombre y su horario. El comensal elige día, ' +
      'hora y cuántos son, y listo: no crea una cuenta ni deja una tarjeta. También ' +
      'entra como un recuadro dentro de la web del local.',
  },
  {
    titulo: 'El turno, en una pantalla',
    texto:
      'La planilla del día con quién viene, cuántos son y qué avisó. El salón dibujado ' +
      'a la hora que quieras mirar, y mover una reserva de mesa es tocar dos mesas.',
  },
  {
    titulo: 'Dos mesas en el mismo lugar, nunca',
    texto:
      'No es una promesa: la base de datos lo rechaza. Aunque entren dos reservas en el ' +
      'mismo instante, por la web y por el mostrador a la vez, una sola se queda con la mesa.',
  },
];

export default async function Inicio() {
  // Quien ya trabaja acá no viene a leer la portada.
  const actual = await sesion();
  if (actual?.tipo === 'admin') redirect('/admin');
  if (actual) redirect('/panel');

  return (
    <main className="publico portada-plataforma">
      <header className="portada">
        <p className="marca-chica">resto</p>
        <h1>Las reservas de tu restaurante, sin planilla y sin cuaderno</h1>
        <p className="descripcion">
          Tu propia página para reservar, las mesas asignadas solas y un panel para
          manejar el turno. El comensal reserva en treinta segundos, sin registrarse y
          sin dejar seña.
        </p>
        <p className="acciones" style={{ marginTop: 26 }}>
          <Link className="boton" href="/login">Entrar al panel</Link>
        </p>
      </header>

      <section className="que-hace">
        {QUE_HACE.map((q) => (
          <article key={q.titulo}>
            <h2>{q.titulo}</h2>
            <p>{q.texto}</p>
          </article>
        ))}
      </section>

      <p className="pie">
        resto · reservas para gastronomía ·{' '}
        <Link href="/login">entrar</Link>
      </p>
    </main>
  );
}
