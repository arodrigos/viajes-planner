-- motivo-y-presupuesto: el «por qué» del modelo y el precio orientativo por
-- parada. Puramente aditivo y nullable: un plan anterior no tiene ninguno de
-- los dos y la tarjeta lo dice en vez de inventarlo.
set search_path = viajes_planner, public, extensions;

alter table paradas
  add column motivo text,
  add column coste jsonb;
