-- controlador-cupo-google: segunda capa de la capa gratuita de Google Maps
-- Platform. La primera, y el único corte duro, son las cuotas diarias de la
-- consola; esto reparte el cupo por debajo de ellas y deja el consumo visible.
-- Aditiva: tablas y funciones nuevas, sin tocar nada existente.
-- (La 025 la ocupa sustitucion_rapida, que aún está en su PR.)
set search_path = viajes_planner, public, extensions;

create table viajes_planner.topes_google (
  sku text primary key,
  tope_dia integer not null check (tope_dia >= 0),
  tope_mes integer not null check (tope_mes >= 0),
  tope_usuario_dia integer check (tope_usuario_dia >= 0)
);

create table viajes_planner.consumo_google (
  sku text not null references viajes_planner.topes_google (sku),
  dia date not null,
  usados integer not null default 0 check (usados >= 0),
  primary key (sku, dia)
);

-- Por usuario solo para los SKU que tienen tope_usuario_dia. Se borra con el
-- usuario: el contador no debe sobrevivir a la cuenta.
create table viajes_planner.consumo_google_usuario (
  usuario_id uuid not null references auth.users (id) on delete cascade,
  sku text not null references viajes_planner.topes_google (sku),
  dia date not null,
  usados integer not null default 0 check (usados >= 0),
  primary key (usuario_id, sku, dia)
);

-- Topes propios por debajo de los de la consola (Text Search 50, UI Kit 300) y
-- estos por debajo de la capa gratuita. Subirlos exige una migración nueva.
insert into viajes_planner.topes_google (sku, tope_dia, tope_mes, tope_usuario_dia) values
  ('text_search_pro', 45, 1350, null),
  ('ui_kit', 250, 7500, 80);

-- Sin políticas para anon ni authenticated: con RLS activada y sin grants,
-- solo service_role (que se salta la RLS) llega a estas tablas.
alter table viajes_planner.topes_google enable row level security;
alter table viajes_planner.consumo_google enable row level security;
alter table viajes_planner.consumo_google_usuario enable row level security;
revoke all on viajes_planner.topes_google, viajes_planner.consumo_google, viajes_planner.consumo_google_usuario
  from public, anon, authenticated;
grant select on viajes_planner.topes_google to service_role;
grant select, insert, update on viajes_planner.consumo_google, viajes_planner.consumo_google_usuario to service_role;

-- Security definer con search_path vacío: la función escribe en tablas a las
-- que el llamador no tendría por qué llegar, y nada de otro esquema puede
-- secuestrarla. El día es el del Pacífico porque es cuando Google reinicia las
-- cuotas diarias. El lock por sku serializa las reservas concurrentes: sin él,
-- dos transacciones leen el mismo contador y ambas pasan el tope.
create or replace function viajes_planner.reservar_cupo_google(p_sku text, p_usuario uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tope viajes_planner.topes_google%rowtype;
  v_dia date := (now() at time zone 'America/Los_Angeles')::date;
  v_dia_usado integer;
  v_mes_usado integer;
  v_usuario_usado integer;
begin
  select * into v_tope from viajes_planner.topes_google where sku = p_sku;
  -- Un sku desconocido no tiene tope que comprobar: se cierra, no se deja pasar.
  if not found then
    return 'tope-dia';
  end if;

  perform pg_advisory_xact_lock(hashtext('cupo_google:' || p_sku));

  select coalesce(sum(usados) filter (where dia = v_dia), 0), coalesce(sum(usados), 0)
    into v_dia_usado, v_mes_usado
  from viajes_planner.consumo_google
  where sku = p_sku and dia >= date_trunc('month', v_dia)::date and dia <= v_dia;

  if v_dia_usado >= v_tope.tope_dia then
    return 'tope-dia';
  end if;
  if v_mes_usado >= v_tope.tope_mes then
    return 'tope-mes';
  end if;

  if p_usuario is not null and v_tope.tope_usuario_dia is not null then
    select coalesce(usados, 0) into v_usuario_usado
    from viajes_planner.consumo_google_usuario
    where usuario_id = p_usuario and sku = p_sku and dia = v_dia;
    if coalesce(v_usuario_usado, 0) >= v_tope.tope_usuario_dia then
      return 'tope-usuario';
    end if;
    insert into viajes_planner.consumo_google_usuario (usuario_id, sku, dia, usados)
    values (p_usuario, p_sku, v_dia, 1)
    on conflict (usuario_id, sku, dia) do update set usados = viajes_planner.consumo_google_usuario.usados + 1;
  end if;

  insert into viajes_planner.consumo_google (sku, dia, usados) values (p_sku, v_dia, 1)
  on conflict (sku, dia) do update set usados = viajes_planner.consumo_google.usados + 1;
  return 'ok';
end;
$$;

-- Solo enteros y claves fijas: lo lee /api/salud, que es público.
create or replace function viajes_planner.consumo_google_resumen()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with h as (select (now() at time zone 'America/Los_Angeles')::date as dia)
  select jsonb_build_object(
    'text_search_hoy', coalesce((select sum(usados) from viajes_planner.consumo_google, h where sku = 'text_search_pro' and consumo_google.dia = h.dia), 0)::integer,
    'text_search_mes', coalesce((select sum(usados) from viajes_planner.consumo_google, h where sku = 'text_search_pro' and consumo_google.dia >= date_trunc('month', h.dia)::date), 0)::integer,
    'ui_kit_hoy', coalesce((select sum(usados) from viajes_planner.consumo_google, h where sku = 'ui_kit' and consumo_google.dia = h.dia), 0)::integer,
    'ui_kit_mes', coalesce((select sum(usados) from viajes_planner.consumo_google, h where sku = 'ui_kit' and consumo_google.dia >= date_trunc('month', h.dia)::date), 0)::integer
  );
$$;

revoke execute on function viajes_planner.reservar_cupo_google(text, uuid) from public, anon, authenticated;
grant execute on function viajes_planner.reservar_cupo_google(text, uuid) to service_role;
revoke execute on function viajes_planner.consumo_google_resumen() from public, anon, authenticated;
grant execute on function viajes_planner.consumo_google_resumen() to service_role;
