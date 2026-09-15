import { poolAdmin, requerirAdmin } from '../../web/contexto';
import { listarLocales } from '../../servicios/administracion';
import { alternarEstado, salirDeAdmin } from './acciones';
import FormularioAlta from './formulario';

export default async function Admin() {
  const admin = await requerirAdmin();
  const locales = await listarLocales(poolAdmin());

  return (
    <>
      <header className="barra">
        <span className="marca">Plataforma</span>
        <span className="quien">{admin.nombre}</span>
        <form action={salirDeAdmin}>
          <button className="secundario chico" type="submit">Salir</button>
        </form>
      </header>

      <main className="contenido">
        <section className="tarjeta">
          <h2>Locales ({locales.length})</h2>
          {locales.length === 0 ? (
            <p className="vacio">Todavía no hay ningún local dado de alta.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Local</th><th>Dirección web</th><th>Mesas</th><th>Próximas</th><th>Estado</th><th /></tr>
              </thead>
              <tbody>
                {locales.map((l) => (
                  <tr key={l.tenantId}>
                    <td><strong>{l.nombre}</strong></td>
                    <td className="apagado">{l.slug}</td>
                    <td>{l.mesas}</td>
                    <td>{l.reservasProximas}</td>
                    <td>
                      <span className={`pastilla ${l.estado === 'activo' ? '' : 'alerta'}`}>
                        {l.estado === 'activo' ? 'Activo' : 'Suspendido'}
                      </span>
                    </td>
                    <td>
                      <form action={alternarEstado}>
                        <input type="hidden" name="tenantId" value={l.tenantId} />
                        <input
                          type="hidden"
                          name="estado"
                          value={l.estado === 'activo' ? 'suspendido' : 'activo'}
                        />
                        <button className="secundario chico" type="submit">
                          {l.estado === 'activo' ? 'Suspender' : 'Reactivar'}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <FormularioAlta />
      </main>
    </>
  );
}
