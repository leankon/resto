-- Un día especial reemplaza el horario de ese día, en vez de recortarlo.
--
-- Antes solo se podía achicar: si el local abre a las 20:00 y un feriado quiere abrir a
-- las 18:00, no había forma de decirlo. Reemplazar cubre los dos casos —abrir antes y
-- abrir menos— y además deja abrir un día en el que normalmente está cerrado.
--
-- Para eso hacen falta dos cosas: varias filas por fecha (un día puede tener brunch y
-- cena) y un último ingreso propio.

-- Una sola fila por fecha ya no alcanza.
ALTER TABLE excepciones_calendario
  DROP CONSTRAINT IF EXISTS excepciones_calendario_tenant_id_fecha_key;

ALTER TABLE excepciones_calendario
  ADD COLUMN IF NOT EXISTS ultimo_ingreso time,
  -- Qué reglas de duración usar ese día. NULL manda a las comodín, que es lo correcto
  -- para un tramo que no se parece a ninguna franja habitual.
  ADD COLUMN IF NOT EXISTS franja_id uuid REFERENCES franjas_servicio(id) ON DELETE SET NULL;

-- Cerrado y con horario son excluyentes: una fila dice una cosa o la otra.
ALTER TABLE excepciones_calendario DROP CONSTRAINT IF EXISTS excepciones_coherentes;
ALTER TABLE excepciones_calendario ADD CONSTRAINT excepciones_coherentes CHECK (
  (cerrado AND desde IS NULL AND hasta IS NULL)
  OR (NOT cerrado AND desde IS NOT NULL AND hasta IS NOT NULL)
);

-- Un día cerrado es uno solo: dos filas de "cerrado" para la misma fecha no significan
-- nada distinto, y conviven mal con los tramos.
DROP INDEX IF EXISTS excepciones_un_cierre_por_fecha;
CREATE UNIQUE INDEX excepciones_un_cierre_por_fecha
  ON excepciones_calendario (tenant_id, fecha) WHERE cerrado;

-- Filas viejas a medio camino: un "no cerrado" sin horario no quiere decir nada.
DELETE FROM excepciones_calendario
 WHERE NOT cerrado AND (desde IS NULL OR hasta IS NULL);

CREATE INDEX IF NOT EXISTS excepciones_por_fecha
  ON excepciones_calendario (tenant_id, fecha);
