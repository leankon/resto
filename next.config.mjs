/** @type {import('next').NextConfig} */
export default {
  // pg trae binarios opcionales que el bundler no tiene que intentar resolver.
  serverExternalPackages: ['pg'],
  // typedRoutes no sirve acá: casi todos los links del panel arman su query string
  // en runtime (fecha, salón, hora), así que el tipo siempre termina siendo string.

  async headers() {
    return [
      {
        // El widget existe para vivir dentro de la web del local: tiene que poder
        // embeberse desde cualquier dominio.
        source: '/r/:path*',
        headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }],
      },
      {
        // El panel, no. Sin esto, cualquiera lo mete en un iframe invisible sobre su
        // propia página y le roba los clicks a quien tenga la sesión abierta.
        source: '/:path((?!r/).*)',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
