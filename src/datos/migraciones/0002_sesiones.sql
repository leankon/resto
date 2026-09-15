-- Autenticación del staff. Usuario y contraseña, sin nada sofisticado.
--
-- El login tiene un problema de orden con RLS: hay que encontrar al usuario por su
-- mail ANTES de saber a qué local pertenece, así que la consulta no puede filtrarse
-- por tenant. En vez de resolverlo con la conexión de superusuario (que puede tocar
-- todo), hay un rol propio que ignora RLS pero solo llega a las cuatro tablas que
-- necesita. Si mañana el código de login tiene un bug, el alcance del daño es ese.

CREATE TABLE sesiones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Se guarda el hash, nunca el token: con una copia de la base no se puede entrar.
  token_hash text NOT NULL UNIQUE,
  usuario_id uuid REFERENCES usuarios(id) ON DELETE CASCADE,
  admin_id   uuid REFERENCES admins_plataforma(id) ON DELETE CASCADE,
  -- Local activo de la sesión. Un encargado de dos locales tiene una sesión por vez.
  tenant_id  uuid REFERENCES tenants(id) ON DELETE CASCADE,
  expira_en  timestamptz NOT NULL,
  creado_en  timestamptz NOT NULL DEFAULT now(),
  CHECK ((usuario_id IS NOT NULL) <> (admin_id IS NOT NULL)),
  CHECK (admin_id IS NULL OR tenant_id IS NULL)
);
CREATE INDEX ON sesiones (expira_en);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resto_auth') THEN
    CREATE ROLE resto_auth LOGIN PASSWORD 'dev' BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO resto_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON sesiones TO resto_auth;
GRANT SELECT, INSERT, UPDATE ON usuarios TO resto_auth;
GRANT SELECT ON usuarios_tenants TO resto_auth;
GRANT SELECT ON admins_plataforma TO resto_auth;
GRANT SELECT ON tenants TO resto_auth;

-- La app normal no necesita ver sesiones.
REVOKE ALL ON sesiones FROM resto_app;
