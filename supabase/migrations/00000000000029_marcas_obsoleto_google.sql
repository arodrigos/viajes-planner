-- limite-obsoleto-google (#240): POST /api/google/ficha con obsoleto=true dejaba
-- que cualquier usuario con sesión marcara una y otra vez como obsoleta una
-- fila compartida de lugares_google, obligando al trabajador a repetir Text
-- Search y gastando el cupo de todos. Aquí se limita a una marca por
-- (usuario, lugar, día del Pacífico) y a 5 marcas por usuario y día.
-- Aditiva: tabla y función nuevas, sin tocar nada existente.
set search_path = viajes_planner, public, extensions;

-- Se borra con el usuario: el contador no debe sobrevivir a la cuenta.
create table viajes_planner.marcas_obsoleto_google (
  usuario_id uuid not null references auth.users (id) on delete cascade,
  clave text not null,
  dia date not null,
  marcado_en timestamptz not null default now(),
  primary key (usuario_id, clave, dia)
);

-- Sin políticas para anon ni authenticated: con RLS activada y sin grants,
-- solo service_role llega a la tabla.
alter table viajes_planner.marcas_obsoleto_google enable row level security;
revoke all on viajes_planner.marcas_obsoleto_google from public, anon, authenticated;
grant select, insert on viajes_planner.marcas_obsoleto_google to service_role;

-- Security definer con search_path vacío, como reservar_cupo_google. El día es
-- el del Pacífico para coincidir con el reinicio de las cuotas de Google. El
-- lock por usuario serializa sus llamadas: sin él, dos transacciones cuentan
-- las mismas marcas y ambas pasan el tope.
create or replace function viajes_planner.registrar_obsoleto_google(p_usuario uuid, p_clave text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dia date := (now() at time zone 'America/Los_Angeles')::date;
  v_tope constant integer := 5;
begin
  perform pg_advisory_xact_lock(hashtext('obsoleto_google:' || p_usuario::text));

  if exists (
    select 1 from viajes_planner.marcas_obsoleto_google
    where usuario_id = p_usuario and clave = p_clave and dia = v_dia
  ) then
    return 'repetido';
  end if;

  if (
    select count(*) from viajes_planner.marcas_obsoleto_google
    where usuario_id = p_usuario and dia = v_dia
  ) >= v_tope then
    return 'tope-usuario';
  end if;

  insert into viajes_planner.marcas_obsoleto_google (usuario_id, clave, dia) values (p_usuario, p_clave, v_dia);
  return 'ok';
end;
$$;

revoke execute on function viajes_planner.registrar_obsoleto_google(uuid, text) from public, anon, authenticated;
grant execute on function viajes_planner.registrar_obsoleto_google(uuid, text) to service_role;
