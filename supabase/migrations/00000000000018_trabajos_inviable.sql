-- destino-multiciudad: un viaje de varias ciudades que no cabe en días,
-- distancia o presupuesto se descarta antes de invocar al modelo. Esta columna
-- guarda las razones y sugerencias en castellano que enseña la pantalla de
-- progreso. Puramente aditiva y nullable: solo un trabajo descartado la tiene.
set search_path = viajes_planner, public, extensions;

alter table trabajos
  add column inviable jsonb;
