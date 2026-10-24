-- Bloque reservas-datos: reservas del viaje (vuelo, tren, hotel, entrada con
-- hora) que apunta el dueño a mano. Datos personales (localizador, horas,
-- hotel): la tabla queda cerrada. El producto lee y escribe solo con
-- service_role (migración 035) y la autorización del dueño la hace la ruta,
-- así que RLS va activada SIN políticas para anon ni authenticated.
-- Solo aditiva: ningún drop, renombrado ni cambio de tipo.
set search_path = viajes_planner, public, extensions;

create table viajes_planner.reservas (
  id uuid primary key default gen_random_uuid(),
  -- Cuelga del plan, no de una versión: guardar una reserva nunca toca el plan.
  plan_id text not null references viajes_planner.planes(id) on delete cascade,
  tipo text not null check (tipo in ('vuelo', 'tren', 'hotel', 'entrada')),
  sentido text check (sentido in ('ida', 'vuelta')),
  fecha_inicio date not null,
  hora_inicio time,
  zona_inicio text check (char_length(zona_inicio) <= 64),
  fecha_fin date,
  hora_fin time,
  zona_fin text check (char_length(zona_fin) <= 64),
  origen text check (char_length(origen) <= 80),
  destino text check (char_length(destino) <= 80),
  nombre text check (char_length(nombre) <= 80),
  direccion text check (char_length(direccion) <= 160),
  localizador text check (char_length(localizador) <= 20),
  notas text check (char_length(notas) <= 200),
  lat double precision check (lat between -90 and 90),
  lon double precision check (lon between -180 and 180),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check ((sentido is not null) = (tipo in ('vuelo', 'tren'))),
  check ((lat is null) = (lon is null)),
  check (fecha_fin is null or fecha_fin >= fecha_inicio),
  -- Obligatorios por tipo: la misma regla que src/lib/reservas/validar.ts.
  check (tipo not in ('vuelo', 'tren') or (
    hora_inicio is not null and fecha_fin is not null and hora_fin is not null
    and origen is not null and destino is not null
    and (fecha_fin > fecha_inicio or hora_fin > hora_inicio)
  )),
  check (tipo <> 'hotel' or (nombre is not null and fecha_fin is not null)),
  check (tipo <> 'entrada' or (
    nombre is not null and hora_inicio is not null
    and (hora_fin is null or (fecha_fin is null or fecha_fin = fecha_inicio) and hora_fin > hora_inicio)
  ))
);

create index reservas_plan_id_idx on viajes_planner.reservas (plan_id);

alter table viajes_planner.reservas enable row level security;
revoke all on viajes_planner.reservas from anon, authenticated;
grant select, insert, update, delete on viajes_planner.reservas to service_role;
