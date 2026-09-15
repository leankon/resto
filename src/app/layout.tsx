import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Reservas',
  description: 'Panel de reservas',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
