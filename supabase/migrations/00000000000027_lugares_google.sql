-- casado-place-id: lo único de Google que se guarda es el place_id (los
-- términos lo permiten cachear sin límite). Nada de ubicación, nombre ni
-- reseñas: por eso la tabla no tiene más columnas que estas cuatro.
-- Aditiva: tabla nueva, sin tocar nada existente.
set search_path = viajes_planner, public, extensions;

create table viajes_planner.lugares_google (
  -- La clave de lugar de la parada (paradas.lugar->>'id'): una por lugar, no
  -- por parada, para que una versión nueva no repita llamadas ya pagadas.
  clave text primary key,
  place_id text,
  estado text not null check (estado in ('casado', 'sin-coincidencia', 'obsoleto', 'error')),
  comprobado_en timestamptz not null,
  -- Un casado sin place_id sería una ficha rota; el resto de estados no lo llevan.
  check ((estado = 'casado') = (place_id is not null))
);

alter table viajes_planner.lugares_google enable row level security;
revoke all on viajes_planner.lugares_google from public, anon, authenticated;
grant select, insert, update, delete on viajes_planner.lugares_google to service_role;

-- El navegador ve el estado (para pintar «sin ficha» o «pendiente») pero
-- nunca el place_id: ese solo sale por la ruta de la ficha, que reserva cupo.
grant select (clave, estado) on viajes_planner.lugares_google to authenticated;
create policy lugares_google_lectura on viajes_planner.lugares_google
  for select to authenticated using (true);
