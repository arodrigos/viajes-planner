-- alternativa-con-guia: las alternativas guardan su propia guía para que
-- «Usar esta» enseñe consejos y curiosidades al instante. Aditiva y
-- nullable: hereda la RLS de la tabla y solo escribe la clave de servicio.
set search_path = viajes_planner, public, extensions;

alter table paradas_alternativas
  add column if not exists guia jsonb,
  add column if not exists curiosidades jsonb,
  add column if not exists guia_intentada_en timestamptz,
  add column if not exists guia_formato smallint;
