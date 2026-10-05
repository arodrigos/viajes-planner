-- etapas-pais: un viaje de varias ciudades guarda sus etapas (ciudad, días,
-- alojamiento y ajustes del planificador) y los traslados estimados entre
-- ellas en la propia versión del plan. Puramente aditiva y nullable: las
-- versiones de una sola ciudad las dejan en null.
set search_path = viajes_planner, public, extensions;

alter table plan_versiones
  add column etapas jsonb,
  add column traslados jsonb;
