-- Bloque generacion (ac2): explicación de exclusiones por categoría de
-- riesgo, guardada junto a la versión del plan en vez de dentro de "dias"
-- porque es información de la versión completa, no de un día concreto.
set search_path = viajes_planner, public, extensions;

alter table plan_versiones add column avisos jsonb not null default '[]'::jsonb;
