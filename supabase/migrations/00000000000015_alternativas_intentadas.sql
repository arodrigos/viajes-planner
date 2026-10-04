-- Bloque alternativas-planes-existentes: marca de intento para el tercer
-- barrido (después del de ubicación y del de fotos). Puramente aditiva
-- (ADD COLUMN, CREATE INDEX): no toca ninguna columna ni tabla existente.
-- Se marca SIEMPRE que se intenta, con éxito o sin él, para que el barrido
-- no vuelva a preguntar a Overpass por la misma parada en cada tick.
set search_path = viajes_planner, public, extensions;

alter table paradas
  add column alternativas_intentadas_en timestamptz;

-- Para encontrar rápido las paradas resueltas que todavía no se han
-- intentado: la condición real la añade el barrido (resolucion->>estado =
-- 'resuelta'), este índice solo acota por lo que SÍ puede expresar un
-- índice parcial estable.
create index paradas_sin_alternativas_intentadas_idx on paradas (plan_version_id) where alternativas_intentadas_en is null;
