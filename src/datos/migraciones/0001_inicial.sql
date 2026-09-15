-- Fase 1: núcleo multi-tenant + inventario de mesas.
--
-- Dos invariantes viven acá y no en el código de aplicación:
--   1. Ninguna mesa puede estar ocupada dos veces a la vez (constraint EXCLUDE).
--   2. Ningún tenant puede leer datos de otro (row level security).
-- Todo lo demás es negociable; esto no.

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- permite mezclar = y && en un EXCLUDE
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
-- El superusuario IGNORA las políticas de RLS. Si la app se conecta como
-- postgres, el aislamiento entre locales no existe y nadie se entera hasta que
-- un local ve las reservas de otro. La app usa resto_app y nada más.
--
-- Ningún rol usa BYPASSRLS, y es a propósito: otorgarlo requiere ser superusuario
-- de verdad, y en Postgres gestionado (Supabase, Neon, RDS) el rol con el que uno
-- entra NO lo es. El acceso ampliado del super-admin se da con políticas apuntadas
-- al rol (`TO resto_admin`), que es más preciso y además funciona en cualquier lado.
-- Los roles se crean SIN contraseña a propósito.
--
-- Postgres gestionado valida la fuerza de la contraseña y rechaza las débiles: Neon
-- corta un `CREATE ROLE ... PASSWORD 'dev'` con un error de su control plane, no de
-- Postgres. Dejar acá una contraseña de desarrollo hacía que el esquema no se pudiera
-- instalar en ningún lado más que en una máquina propia.
--
-- En local no hace falta ninguna: el cluster de `scripts/db-local.sh` usa autenticación
-- `trust`. En un despliegue real, la contraseña se pone al instalar, y tiene que ser
-- fuerte y sin caracteres que rompan una URL (ver docs/06-desplegar.md).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resto_app') THEN
    CREATE ROLE resto_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'resto_admin') THEN
    CREATE ROLE resto_admin LOGIN;
  END IF;
  -- Converge el estado, pero solo si hace falta: cambiar SUPERUSER o BYPASSRLS exige
  -- ser superusuario de verdad, y en Postgres gestionado (Neon, Supabase, RDS) no lo
  -- somos. Ahí los roles nacen sin esos atributos, así que no hay nada que corregir y
  -- este bloque no se ejecuta. En una base propia que ya los tenía, sí corrige.
  --
  -- Si algún día esta condición diera verdadera en una base gestionada, que falle es
  -- lo correcto: significaría que los roles pueden saltear el aislamiento entre
  -- locales, y eso tiene que enterarse alguien en vez de pasar en silencio.
  IF EXISTS (SELECT 1 FROM pg_roles
              WHERE rolname IN ('resto_app', 'resto_admin')
                AND (rolsuper OR rolbypassrls)) THEN
    ALTER ROLE resto_app NOBYPASSRLS NOSUPERUSER;
    ALTER ROLE resto_admin NOBYPASSRLS NOSUPERUSER;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Plataforma
-- ---------------------------------------------------------------------------
CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  nombre        text NOT NULL,
  tz            text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  pais          text NOT NULL DEFAULT 'AR',   -- para normalizar teléfonos a E.164
  estado        text NOT NULL DEFAULT 'activo'
                CHECK (estado IN ('activo', 'suspendido')),
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

-- Vacía en Fase 1. Existe para que sumar dominio propio no sea una migración dolorosa.
CREATE TABLE tenant_dominios (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dominio    text NOT NULL UNIQUE,
  verificado boolean NOT NULL DEFAULT false,
  creado_en  timestamptz NOT NULL DEFAULT now()
);

-- 1:N desde el día uno (D4): el número compartido es una fila más.
CREATE TABLE tenant_canales_whatsapp (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero_e164   text NOT NULL,
  phone_number_id text NOT NULL,
  es_compartido boolean NOT NULL DEFAULT false,
  activo        boolean NOT NULL DEFAULT true,
  creado_en     timestamptz NOT NULL DEFAULT now()
);

-- Un admin de plataforma no es un usuario con un flag: mezclarlos es cómo se
-- filtran privilegios.
CREATE TABLE admins_plataforma (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email     text NOT NULL UNIQUE,
  hash      text NOT NULL,
  nombre    text NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email     text NOT NULL UNIQUE,
  hash      text NOT NULL,
  nombre    text NOT NULL,
  activo    boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now()
);

-- N:M: una persona puede trabajar en dos locales sin duplicar cuenta.
CREATE TABLE usuarios_tenants (
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rol        text NOT NULL CHECK (rol IN ('dueño', 'encargado', 'mozo')),
  creado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, tenant_id)
);

-- ---------------------------------------------------------------------------
-- Salón
-- ---------------------------------------------------------------------------
CREATE TABLE salones (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre    text NOT NULL,
  orden     int  NOT NULL DEFAULT 0,   -- orden de las solapas en el panel (D9)
  activo    boolean NOT NULL DEFAULT true
);
CREATE INDEX ON salones (tenant_id);

CREATE TABLE mesas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  salon_id       uuid NOT NULL REFERENCES salones(id) ON DELETE CASCADE,
  nombre         text NOT NULL,
  capacidad_base int  NOT NULL CHECK (capacidad_base > 0),
  cabeceras      int  NOT NULL DEFAULT 0 CHECK (cabeceras BETWEEN 0 AND 2),
  capacidad_min  int  NOT NULL DEFAULT 1 CHECK (capacidad_min > 0),
  -- Centro de la mesa sobre el plano. Desde D7 son entrada del motor, no decoración.
  x              int NOT NULL DEFAULT 0,
  y              int NOT NULL DEFAULT 0,
  forma          text NOT NULL DEFAULT 'rect'
                 CHECK (forma IN ('rect', 'redonda', 'barra')),
  combinable     boolean NOT NULL DEFAULT true,
  activa         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, salon_id, nombre)
);
CREATE INDEX ON mesas (tenant_id, salon_id);

-- Escape hatch: dos mesas cerca que en la práctica no se pueden unir (una columna
-- en el medio). Arranca vacía; no es un paso del alta.
CREATE TABLE combinaciones_vetadas (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mesa_a_id uuid NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  mesa_b_id uuid NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  motivo    text,
  PRIMARY KEY (mesa_a_id, mesa_b_id),
  CHECK (mesa_a_id < mesa_b_id)   -- par canónico: una sola fila por combinación
);

CREATE TABLE franjas_servicio (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nombre         text NOT NULL,
  dias           int[] NOT NULL,      -- 0 = domingo
  desde          time NOT NULL,
  hasta          time NOT NULL,       -- si hasta <= desde, cruza medianoche
  ultimo_ingreso time NOT NULL,
  activa         boolean NOT NULL DEFAULT true
);
CREATE INDEX ON franjas_servicio (tenant_id);

-- D1: la duración no es un número de config, es una tabla de reglas.
CREATE TABLE duraciones_turno (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  franja_id    uuid REFERENCES franjas_servicio(id) ON DELETE CASCADE,  -- NULL = comodín
  personas_min int NOT NULL,
  personas_max int NOT NULL,
  duracion_min int NOT NULL CHECK (duracion_min > 0),
  buffer_min   int NOT NULL DEFAULT 15 CHECK (buffer_min >= 0),
  CHECK (personas_min <= personas_max)
);
CREATE INDEX ON duraciones_turno (tenant_id);

CREATE TABLE excepciones_calendario (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fecha     date NOT NULL,
  cerrado   boolean NOT NULL DEFAULT false,
  desde     time,
  hasta     time,
  motivo    text,
  UNIQUE (tenant_id, fecha)
);

-- ---------------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------------
-- El historial es POR LOCAL y no se cruza entre tenants: dos locales que tienen
-- al mismo comensal ven dos filas distintas. Lo pide el brief y además es lo
-- correcto legalmente. El cliente nunca crea una cuenta.
CREATE TABLE clientes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  telefono_e164   text,          -- canónico: el que se marca o se usa en WhatsApp
  telefono_clave  text,          -- deduplicación: ver dominio/clientes.ts
  email           text,
  nombre          text NOT NULL,
  visitas         int NOT NULL DEFAULT 0,
  no_shows        int NOT NULL DEFAULT 0,
  cancelaciones   int NOT NULL DEFAULT 0,
  ultima_visita_en timestamptz,
  notas           text,
  etiquetas       text[] NOT NULL DEFAULT '{}',
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  CHECK (telefono_clave IS NOT NULL OR email IS NOT NULL),
  CHECK ((telefono_e164 IS NULL) = (telefono_clave IS NULL))
);
-- Índices parciales: el teléfono identifica al cliente dentro del local; si no
-- dejó teléfono, el mail hace de identificador alternativo.
--
-- El único va sobre telefono_clave, no sobre telefono_e164: en Argentina el mismo
-- celular tiene dos E.164 válidos según cómo lo tipeen (con o sin el 9 de celular),
-- y si la identidad dependiera del E.164 el mismo comensal quedaría partido en dos
-- clientes con medio historial cada uno.
CREATE UNIQUE INDEX clientes_tenant_telefono
  ON clientes (tenant_id, telefono_clave) WHERE telefono_clave IS NOT NULL;
CREATE UNIQUE INDEX clientes_tenant_email
  ON clientes (tenant_id, lower(email)) WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Reservas
-- ---------------------------------------------------------------------------
CREATE TABLE reservas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cliente_id    uuid REFERENCES clientes(id) ON DELETE SET NULL,  -- NULL en walk-in
  inicio        timestamptz NOT NULL,
  duracion_min  int NOT NULL CHECK (duracion_min > 0),
  buffer_min    int NOT NULL DEFAULT 15,
  personas      int NOT NULL CHECK (personas > 0),
  estado        text NOT NULL DEFAULT 'confirmada' CHECK (estado IN (
                  'confirmada', 'sentada', 'finalizada',
                  'cancelada', 'no_show', 'hold', 'en_riesgo')),
  canal_origen  text NOT NULL CHECK (canal_origen IN (
                  'web', 'widget', 'whatsapp', 'manual', 'walk_in')),
  notas         text,
  creada_por_usuario_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  expira_en     timestamptz,   -- solo para estado 'hold' (ofertas de lista de espera)
  creado_en     timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  -- Un walk-in no tiene cliente; una reserva de cualquier otro canal sí.
  CHECK (canal_origen = 'walk_in' OR cliente_id IS NOT NULL)
);
CREATE INDEX ON reservas (tenant_id, inicio);
CREATE INDEX ON reservas (tenant_id, estado, inicio);
CREATE INDEX ON reservas (cliente_id);

-- El inventario. Una reserva tiene N filas acá si ocupa una combinación.
CREATE TABLE reservas_mesas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reserva_id  uuid NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
  mesa_id     uuid NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  periodo     tstzrange NOT NULL,   -- incluye el buffer de limpieza
  -- D2: el re-optimizador nunca pisa una decisión humana.
  fijada_manualmente boolean NOT NULL DEFAULT false,
  bloqueante  boolean NOT NULL DEFAULT true,
  creado_en   timestamptz NOT NULL DEFAULT now(),

  -- EL invariante del sistema. Con esto, ningún bug de aplicación, ninguna
  -- carrera entre canales y ningún INSERT a mano desde psql puede sentar dos
  -- reservas en la misma mesa a la misma hora.
  CONSTRAINT reservas_mesas_sin_solape
    EXCLUDE USING gist (mesa_id WITH =, periodo WITH &&) WHERE (bloqueante)
);
CREATE INDEX ON reservas_mesas (reserva_id);
CREATE INDEX ON reservas_mesas USING gist (mesa_id, periodo) WHERE bloqueante;

-- Mesa fuera de servicio: mantenimiento, evento privado. Ocupa como cualquier
-- otra cosa, por la misma constraint.
CREATE TABLE bloqueos (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mesa_id   uuid NOT NULL REFERENCES mesas(id) ON DELETE CASCADE,
  periodo   tstzrange NOT NULL,
  motivo    text NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON bloqueos USING gist (mesa_id, periodo);

-- Append-only: es la fuente de verdad de la historia, no un log de conveniencia.
CREATE TABLE reservas_eventos (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reserva_id     uuid NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
  tipo           text NOT NULL,
  actor_tipo     text NOT NULL CHECK (actor_tipo IN (
                   'cliente', 'staff', 'sistema', 'admin_plataforma')),
  actor_id       uuid,
  correlacion_id uuid,   -- vincula los dos eventos de un intercambio de mesas
  datos          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { antes, despues, motivo }
  en             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON reservas_eventos (tenant_id, reserva_id, en);

-- El "por qué" de cada decisión del motor. Guardar los descartados con su motivo
-- es lo que permite responder "¿por qué me dijo que no había lugar si la mesa 7
-- estaba vacía?" sin una sesión de debugging a ciegas.
CREATE TABLE asignaciones_log (
  id                bigserial PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reserva_id        uuid REFERENCES reservas(id) ON DELETE CASCADE,
  version_algoritmo text NOT NULL,
  explicacion       jsonb NOT NULL,
  en                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON asignaciones_log (tenant_id, en);

-- ---------------------------------------------------------------------------
-- Sincronización estado de reserva -> bloqueante del inventario
-- ---------------------------------------------------------------------------
-- 'finalizada' SIGUE bloqueando: si la mesa se liberó antes, lo que corresponde
-- es achicar el periodo (y esos minutos vuelven al inventario), no borrar el
-- hecho de que estuvo ocupada.
CREATE OR REPLACE FUNCTION estado_bloquea(p_estado text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$
  SELECT p_estado IN ('confirmada', 'sentada', 'hold', 'en_riesgo', 'finalizada');
$$;

CREATE OR REPLACE FUNCTION sync_bloqueante() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  UPDATE reservas_mesas
     SET bloqueante = estado_bloquea(NEW.estado)
   WHERE reserva_id = NEW.id
     AND bloqueante IS DISTINCT FROM estado_bloquea(NEW.estado);
  RETURN NEW;
END $$;

CREATE TRIGGER reservas_sync_bloqueante
  AFTER UPDATE OF estado ON reservas
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION sync_bloqueante();

-- Al insertar, el inventario hereda el estado de su reserva: la app no puede
-- olvidarse de setearlo.
CREATE OR REPLACE FUNCTION set_bloqueante_inicial() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  SELECT estado_bloquea(estado) INTO NEW.bloqueante FROM reservas WHERE id = NEW.reserva_id;
  RETURN NEW;
END $$;

CREATE TRIGGER reservas_mesas_bloqueante_inicial
  BEFORE INSERT ON reservas_mesas
  FOR EACH ROW EXECUTE FUNCTION set_bloqueante_inicial();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- El bug clásico de este modelo es una consulta a la que se le olvidó el
-- WHERE tenant_id. Con RLS esa consulta devuelve cero filas en vez de datos
-- ajenos: el bug pasa de incidente de privacidad a página vacía.
CREATE OR REPLACE FUNCTION tenant_actual() RETURNS uuid
  LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_dominios', 'tenant_canales_whatsapp', 'usuarios_tenants',
    'salones', 'mesas', 'combinaciones_vetadas', 'franjas_servicio',
    'duraciones_turno', 'excepciones_calendario', 'clientes', 'reservas',
    'reservas_mesas', 'bloqueos', 'reservas_eventos', 'asignaciones_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE hace que la política valga incluso para el dueño de la tabla.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO resto_app
         USING (tenant_id = tenant_actual()) WITH CHECK (tenant_id = tenant_actual())',
      t || '_app', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO resto_admin USING (true) WITH CHECK (true)',
      t || '_admin', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO resto_app, resto_admin', t);
  END LOOP;
END $$;

-- El propio tenant solo se ve a sí mismo.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_app ON tenants FOR ALL TO resto_app
  USING (id = tenant_actual()) WITH CHECK (id = tenant_actual());
CREATE POLICY tenants_admin ON tenants FOR ALL TO resto_admin
  USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON tenants TO resto_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants TO resto_admin;

-- Los usuarios se filtran por su pertenencia al tenant activo, no por tenant_id.
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios FORCE ROW LEVEL SECURITY;
CREATE POLICY usuarios_app ON usuarios FOR ALL TO resto_app USING (
  EXISTS (SELECT 1 FROM usuarios_tenants ut
           WHERE ut.usuario_id = usuarios.id AND ut.tenant_id = tenant_actual())
);
CREATE POLICY usuarios_admin ON usuarios FOR ALL TO resto_admin
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON usuarios TO resto_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON usuarios TO resto_admin;

-- Dar de alta locales y admins de plataforma no ocurre dentro de ningún tenant.
GRANT SELECT, INSERT, UPDATE, DELETE ON admins_plataforma TO resto_admin;

GRANT USAGE ON SCHEMA public TO resto_app, resto_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO resto_app, resto_admin;
