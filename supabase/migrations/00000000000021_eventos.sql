-- eventos: festivos y fiestas que caen en las fechas de cada versión del plan.
-- Puramente aditivo y nullable: una versión anterior no tiene eventos y la
-- vista lo dice. `eventos_intentados_en` distingue «aún no se ha consultado»
-- (null) de «se consultó» (con fecha), igual que guia_intentada_en; un fallo
-- de las fuentes lo deja a null para reintentar.
set search_path = viajes_planner, public, extensions;

alter table plan_versiones
  add column eventos jsonb,
  add column eventos_intentados_en timestamptz;
