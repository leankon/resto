-- Fase 2: la página pública de reservas.
--
-- Hasta acá el sistema lo operaba el staff. A partir de ahora entra gente de la calle,
-- y eso trae dos necesidades nuevas: qué muestra y qué acepta el local de cara al
-- público, y cómo una persona vuelve a su reserva sin tener cuenta.

ALTER TABLE tenants
  -- Un local puede tener el panel andando y la web todavía apagada.
  ADD COLUMN IF NOT EXISTS web_publica boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS direccion text,
  ADD COLUMN IF NOT EXISTS telefono_publico text,
  ADD COLUMN IF NOT EXISTS descripcion text,
  -- Cuánto antes hay que reservar. Sin esto entran reservas para dentro de 5 minutos
  -- y la cocina se entera cuando la gente ya está en la puerta.
  ADD COLUMN IF NOT EXISTS anticipacion_min int NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS dias_max_anticipacion int NOT NULL DEFAULT 60,
  -- Arriba de esto la web manda a llamar: un grupo de 20 se arma a mano.
  ADD COLUMN IF NOT EXISTS personas_max_web int NOT NULL DEFAULT 10,
  -- Hasta cuándo puede cancelar solo el cliente. Después, lo hace el local.
  ADD COLUMN IF NOT EXISTS cancelacion_min int NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS mensaje_confirmacion text;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_limites_web;
ALTER TABLE tenants ADD CONSTRAINT tenants_limites_web CHECK (
  anticipacion_min BETWEEN 0 AND 43200 AND
  dias_max_anticipacion BETWEEN 1 AND 365 AND
  personas_max_web BETWEEN 1 AND 100 AND
  cancelacion_min BETWEEN 0 AND 43200
);

-- Cómo vuelve alguien a su reserva sin tener cuenta (el brief es explícito: el
-- comensal nunca se registra). El link que recibe lleva un token al azar; acá se
-- guarda solo el hash, igual que con las sesiones del staff: con una copia de la base
-- no se puede cancelar la cena de nadie.
--
-- Un token por reserva. Emitir uno nuevo (para reenviar el link) invalida el anterior,
-- que es justo lo que se quiere si el primero se mandó al mail equivocado.
ALTER TABLE reservas ADD COLUMN IF NOT EXISTS token_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS reservas_token_hash_idx ON reservas (token_hash);
