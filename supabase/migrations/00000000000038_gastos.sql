-- Bloque gastos-datos-y-comparacion: gasto real que apunta el dueño (importe,
-- día y categoría). Datos personales: la tabla queda cerrada. El producto lee
-- y escribe solo con service_role (migración 035) y la autorización del dueño
-- la hace la ruta, así que RLS va activada SIN políticas para anon ni
-- authenticated. Solo aditiva: ningún drop, renombrado ni cambio de tipo.
set search_path = viajes_planner, public, extensions;

create table viajes_planner.gastos (
  -- Lo genera el cliente: así un reintento tras un corte de red no duplica.
  id uuid primary key,
  -- Cuelga del plan, no de una versión: apuntar un gasto nunca toca el plan.
  plan_id text not null references viajes_planner.planes(id) on delete cascade,
  importe_centimos integer not null check (importe_centimos between 1 and 10000000),
  -- null = «Todo el viaje».
  fecha date,
  categoria text not null check (categoria in ('comida', 'entradas', 'transporte', 'alojamiento')),
  concepto text check (char_length(concepto) <= 80),
  actualizado_cliente timestamptz not null,
  creado_en timestamptz not null default now(),
  -- Regla de los gastos grandes: la misma que src/lib/gastos/validar.ts.
  check (categoria <> 'alojamiento' or fecha is null),
  check (categoria not in ('comida', 'entradas') or fecha is not null)
);

create index gastos_plan_id_idx on viajes_planner.gastos (plan_id);

alter table viajes_planner.gastos enable row level security;
revoke all on viajes_planner.gastos from anon, authenticated;
grant select, insert, update, delete on viajes_planner.gastos to service_role;

-- Upsert idempotente: aplicado dos veces con lo mismo deja la tabla igual, y un
-- envío más viejo que lo guardado no lo pisa.
create or replace function viajes_planner.guardar_gasto(
  p_plan_id text,
  p_id uuid,
  p_importe integer,
  p_fecha date,
  p_categoria text,
  p_concepto text,
  p_actualizado timestamptz
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (select 1 from viajes_planner.gastos g where g.id = p_id and g.plan_id <> p_plan_id) then
    raise exception 'gasto-de-otro-plan';
  end if;
  insert into viajes_planner.gastos as g (id, plan_id, importe_centimos, fecha, categoria, concepto, actualizado_cliente)
  values (p_id, p_plan_id, p_importe, p_fecha, p_categoria, p_concepto, p_actualizado)
  on conflict (id) do update
    set importe_centimos = excluded.importe_centimos,
        fecha = excluded.fecha,
        categoria = excluded.categoria,
        concepto = excluded.concepto,
        actualizado_cliente = excluded.actualizado_cliente
    where g.plan_id = p_plan_id and g.actualizado_cliente < p_actualizado;
end;
$$;

revoke execute on function viajes_planner.guardar_gasto(text, uuid, integer, date, text, text, timestamptz) from public, anon, authenticated;
grant execute on function viajes_planner.guardar_gasto(text, uuid, integer, date, text, text, timestamptz) to service_role;
