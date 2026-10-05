-- guia-abierta: consejos de la guía (Wikivoyage) y curiosidades (Wikipedia)
-- por parada. Puramente aditivo y nullable: un plan anterior no tiene ninguno
-- y la tarjeta lo dice en vez de inventarlo. `guia_intentada_en` distingue
-- «aún no se ha mirado» (null) de «se miró y no había nada» (con fecha),
-- igual que foto_intentada_en.
set search_path = viajes_planner, public, extensions;

alter table paradas
  add column guia jsonb,
  add column curiosidades jsonb,
  add column guia_intentada_en timestamptz;
