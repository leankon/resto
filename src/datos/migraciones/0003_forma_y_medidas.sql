-- Forma de las mesas y medidas del salón.
--
-- El plano se dibujaba escalándose solo para que entraran todas las mesas. El efecto
-- era que al arrastrar una mesa hacia el borde, la escala cambiaba y todo el plano se
-- movía debajo del dedo: la mesa parecía volver para atrás. Un salón tiene un tamaño
-- real, así que ahora se declara y el dibujo respeta ese tamaño.

ALTER TABLE salones
  ADD COLUMN IF NOT EXISTS ancho_cm int NOT NULL DEFAULT 1200,
  ADD COLUMN IF NOT EXISTS alto_cm  int NOT NULL DEFAULT 800;

ALTER TABLE salones
  DROP CONSTRAINT IF EXISTS salones_medidas_razonables;
ALTER TABLE salones
  ADD CONSTRAINT salones_medidas_razonables
  CHECK (ancho_cm BETWEEN 200 AND 10000 AND alto_cm BETWEEN 200 AND 10000);

-- 'cuadrada' faltaba: una mesa de cuatro cuadrada y una rectangular se ven distinto en
-- el plano y se unen distinto en la práctica.
ALTER TABLE mesas DROP CONSTRAINT IF EXISTS mesas_forma_check;
ALTER TABLE mesas
  ADD CONSTRAINT mesas_forma_check
  CHECK (forma IN ('rect', 'cuadrada', 'redonda', 'barra'));
