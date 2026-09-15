import { poolAuth } from '../../../../web/contexto';
import { localPorSlug } from '../../../../servicios/publico';

/**
 * El script que el local pega en su web.
 *
 * Una sola etiqueta `<script>` y el recuadro de reservas aparece donde esté puesta.
 * Se sirve desde acá, y no como archivo estático, para que lleve adentro la dirección
 * de este servidor: el local copia y pega, no configura nada.
 */
export async function GET(
  _pedido: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const local = await localPorSlug(poolAuth(), slug);
  if (!local) return new Response('// Local no encontrado', { status: 404 });

  const script = `(function () {
  var actual = document.currentScript;
  if (!actual) return;
  var origen = new URL(actual.src).origin;
  var destino = origen + '/r/${local.slug}/widget';

  var marco = document.createElement('iframe');
  marco.src = destino;
  marco.title = 'Reservar en ${local.nombre.replace(/'/g, "\\'")}';
  marco.loading = 'lazy';
  marco.style.cssText = 'width:100%;border:0;display:block;min-height:520px';
  // El iframe no comparte cookies ni storage con la web del local, y no puede
  // navegarla ni abrir ventanas por su cuenta.
  marco.setAttribute('sandbox', 'allow-forms allow-scripts allow-same-origin');
  actual.parentNode.insertBefore(marco, actual);

  window.addEventListener('message', function (evento) {
    // Solo se escucha a este iframe y solo a nuestro servidor: cualquier otra página
    // abierta puede mandar mensajes a esta ventana.
    if (evento.origin !== origen) return;
    if (evento.source !== marco.contentWindow) return;
    var dato = evento.data;
    if (!dato || dato.resto !== 'alto') return;
    var alto = Number(dato.alto);
    if (alto > 0 && alto < 4000) marco.style.height = alto + 'px';
  });
})();
`;

  return new Response(script, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      // Un minuto: si el local apaga su web, el script deja de servir rápido.
      'cache-control': 'public, max-age=60',
    },
  });
}
