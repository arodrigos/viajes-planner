-- consejos-completos: versión del formato con que se guardó la guía de cada
-- parada. Aditiva y nullable: null = guardada antes de que el consejo
-- cupiera entero, y el barrido la vuelve a pedir una sola vez.
set search_path = viajes_planner, public, extensions;

alter table paradas
  add column guia_formato smallint;
