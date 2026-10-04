-- Bloque alternativas-equivalentes: alternativas equivalentes por parada,
-- cada una resuelta contra las mismas fuentes abiertas que paradas.lugar.
-- Tabla propia (y no una columna jsonb en paradas) porque el endpoint de
-- sustitución necesita referenciar UNA alternativa concreta por id. RLS
-- activada y SIN políticas para anon/authenticated: solo service_role (ya
-- sin RLS por rol, ver migración 001) puede leerla o escribirla -- misma
-- cautela que el resto de tablas de este esquema con datos de un plan.
set search_path = viajes_planner, public, extensions;

create table paradas_alternativas (
  id uuid primary key default gen_random_uuid(),
  parada_id uuid not null references paradas (id) on delete cascade,
  origen text not null check (origen in ('modelo', 'cercano')),
  nombre text not null,
  descripcion text not null,
  motivo text not null,
  duracion_min numeric not null,
  categoria text not null,
  lat double precision,
  lon double precision,
  lugar jsonb,
  foto jsonb,
  creado_en timestamptz not null default now()
);

create index paradas_alternativas_parada_id_idx on paradas_alternativas (parada_id);

alter table paradas_alternativas enable row level security;
