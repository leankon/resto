import type { ReactNode } from 'react';
import { Fraunces } from 'next/font/google';
import './globals.css';

/**
 * La tipografía de los títulos. Se usa en el nombre del local de la página pública,
 * que es lo único que tiene que verse como un restaurante y no como un formulario.
 *
 * `next/font` la descarga al compilar y la sirve desde el mismo dominio: no hay pedido
 * a Google desde el navegador de quien reserva, ni el salto de fuente al cargar.
 */
const titulos = Fraunces({
  subsets: ['latin'],
  weight: ['600', '700'],
  display: 'swap',
  variable: '--fuente-titulos',
});

export const metadata = {
  title: 'Reservas',
  description: 'Panel de reservas',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={titulos.variable}>
      <body>{children}</body>
    </html>
  );
}
