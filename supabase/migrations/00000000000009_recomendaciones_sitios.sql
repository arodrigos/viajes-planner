-- Bloque recomendaciones-de-sitios: sitios de comida o recintos que el
-- modelo puede sugerir al margen del itinerario por franjas. Igual que
-- avisos, va junto a la versión del plan (no tiene tabla propia como las
-- paradas porque no se referencia individualmente desde ningún otro sitio).
set search_path = viajes_planner, public, extensions;

alter table plan_versiones add column recomendaciones jsonb not null default '[]'::jsonb;
