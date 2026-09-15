import { redirect } from 'next/navigation';
import { sesion } from '../web/contexto';

export default async function Inicio() {
  const actual = await sesion();
  if (actual?.tipo === 'admin') redirect('/admin');
  redirect(actual ? '/panel' : '/login');
}
