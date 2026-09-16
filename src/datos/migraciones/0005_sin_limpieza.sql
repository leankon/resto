-- El tiempo de limpieza deja de ocupar turno.
--
-- Entre dos comensales se pasa un trapo: no se le avisa a nadie, no se le cobra a la
-- mesa y no llega a un minuto. Reservarle quince minutos a cada turno tira una mesa
-- entera por noche, y hace que un turno de dos horas que arranca a las 21:00 muestre la
-- mesa ocupada a las 23:00, cuando en realidad ya está libre.
--
-- La función sigue existiendo para el local que necesite margen de verdad —mantel,
-- cubiertos, una mesa larga que hay que rearmar—: se sube desde el panel, en
-- Horarios → Cuánto dura un turno.

ALTER TABLE reservas ALTER COLUMN buffer_min SET DEFAULT 0;
ALTER TABLE duraciones_turno ALTER COLUMN buffer_min SET DEFAULT 0;

-- Los locales que ya existen tenían los quince minutos sembrados por el sistema, no
-- elegidos por nadie. Se ponen en cero; el que quiera margen lo vuelve a cargar.
UPDATE duraciones_turno SET buffer_min = 0;

-- Las reservas futuras se recalculan: la mesa se libera cuando termina el turno, no
-- un cuarto de hora más tarde. Las pasadas se dejan como están, porque son historia.
UPDATE reservas_mesas rm
   SET periodo = tstzrange(lower(rm.periodo),
                           lower(rm.periodo) + make_interval(mins => r.duracion_min),
                           '[)')
  FROM reservas r
 WHERE r.id = rm.reserva_id
   AND r.inicio > now()
   AND r.buffer_min > 0;

UPDATE reservas SET buffer_min = 0 WHERE inicio > now() AND buffer_min > 0;
