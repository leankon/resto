-- Cada cuánto ofrece horarios la página pública.
--
-- Quince minutos le da al cliente muchas opciones y reparte la llegada de la gente; una
-- hora concentra todo en punto, que para una cocina chica puede ser justo lo que
-- conviene. No hay una respuesta buena para todos los locales, así que la elige el dueño.
--
-- Solo afecta lo que se le OFRECE al cliente en la web. El staff sigue pudiendo cargar
-- cualquier hora desde el mostrador: el que llama por teléfono pide las 21:10.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS paso_reserva_min int NOT NULL DEFAULT 15;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_paso_razonable;
ALTER TABLE tenants ADD CONSTRAINT tenants_paso_razonable
  CHECK (paso_reserva_min IN (15, 30, 60));
