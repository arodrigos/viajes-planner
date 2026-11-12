-- Bloque preparativos-datos: marcas de la lista de preparativos y equipaje
-- (hecho / no me hace falta). Revelan que viajan menores y su edad, así que la
-- tabla queda cerrada: RLS activada SIN políticas, sin privilegios para anon ni
-- authenticated, y solo service_role (la ruta comprueba antes que es el dueño).
-- Solo aditiva: ningún drop, renombrado ni cambio de tipo.
set search_path = viajes_planner, public, extensions;

create table viajes_planner.preparativos_marcas (
  plan_id text not null references viajes_planner.planes(id) on delete cascade,
  -- Id estable del catálogo de src/lib/preparativos/catalogo.ts.
  elemento text not null check (elemento ~ '^[a-z0-9-]{1,60}$'),
  estado text not null check (estado in ('pendiente', 'hecho', 'no_hace_falta')),
  actualizado_cliente timestamptz not null,
  creado_en timestamptz not null default now(),
  primary key (plan_id, elemento)
);

alter table viajes_planner.preparativos_marcas enable row level security;
revoke all on viajes_planner.preparativos_marcas from anon, authenticated;
grant select, insert, update, delete on viajes_planner.preparativos_marcas to service_role;

-- Upsert idempotente: aplicado dos veces con lo mismo deja la tabla igual, y un
-- envío más viejo que lo guardado no lo pisa (last-write-wins).
create or replace function viajes_planner.guardar_marca_preparativo(
  p_plan_id text,
  p_elemento text,
  p_estado text,
  p_actualizado timestamptz
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into viajes_planner.preparativos_marcas as m (plan_id, elemento, estado, actualizado_cliente)
  values (p_plan_id, p_elemento, p_estado, p_actualizado)
  on conflict (plan_id, elemento) do update
    set estado = excluded.estado,
        actualizado_cliente = excluded.actualizado_cliente
    where m.actualizado_cliente < p_actualizado;
end;
$$;

revoke execute on function viajes_planner.guardar_marca_preparativo(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function viajes_planner.guardar_marca_preparativo(text, text, text, timestamptz) to service_role;
