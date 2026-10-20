-- Bloque compartir-datos: el dueño de un plan lo comparte en solo lectura con
-- otras personas, identificadas por su correo (pueden no haber entrado nunca).
-- Solo service_role escribe: la API comprueba que quien invita es el dueño.
-- RLS es la segunda capa para quien consulte por REST con su propio JWT.
set search_path = viajes_planner, public, extensions;

create table miembros_plan (
  id uuid primary key default gen_random_uuid(),
  plan_id text not null references planes(id) on delete cascade,
  correo text not null check (correo = lower(correo) and char_length(correo) between 3 and 254),
  invitado_por uuid not null references auth.users(id),
  creado_en timestamptz not null default now(),
  unique (plan_id, correo)
);

create index miembros_plan_correo_idx on miembros_plan (correo);

-- Sin FORCE: service_role atraviesa RLS como en el resto de tablas.
alter table miembros_plan enable row level security;

-- Los privilegios por defecto del esquema dan acceso a anon; esta tabla guarda
-- correos de terceros, así que se cierra explícitamente.
revoke all on miembros_plan from anon;
revoke insert, update, delete on miembros_plan from authenticated;
grant select on miembros_plan to authenticated;
grant select, insert, update, delete on miembros_plan to service_role;

create policy "un usuario ve las invitaciones a su correo"
  on miembros_plan for select to authenticated
  using (correo = lower((select auth.jwt()) ->> 'email'));

create policy "el dueño ve los miembros de sus planes"
  on miembros_plan for select to authenticated
  using (exists (
    select 1 from viajes_planner.trabajos t
     where t.plan_id = miembros_plan.plan_id
       and t.usuario_id = (select auth.uid())
       and t.eliminado_en is null
  ));
