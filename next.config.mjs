/** @type {import('next').NextConfig} */
export default {
  // pg trae binarios opcionales que el bundler no tiene que intentar resolver.
  serverExternalPackages: ['pg'],
  // typedRoutes no sirve acá: casi todos los links del panel arman su query string
  // en runtime (fecha, salón, hora), así que el tipo siempre termina siendo string.
};
