-- Bloque persistencia: las tablas base del plan y su cola de trabajos.
-- RLS activada en todas con denegación por defecto (sin políticas para
-- anon/authenticated): la única vía de lectura/escritura es la clave de
-- servicio, que en Supabase atraviesa RLS. El bloque acceso añade las
-- políticas por propietario cuando exista auth.users que referenciar.

create extension if not exists pgcrypto;

create table planes (
  id text primary key,
  destino text not null,
  creado_en timestamptz not null default now()
);

create table plan_versiones (
  id uuid primary key default gen_random_uuid(),
  plan_id text not null references planes (id) on delete cascade,
  version integer not null,
  personas integer not null check (personas > 0),
  -- Días sin sus paradas: fecha, ancla_alojamiento y franjas (id, etiqueta,
  -- hora_inicio, hora_fin). Las paradas viven en su propia tabla porque
  -- procedencias y visitas necesitan referenciarlas una a una.
  dias jsonb not null,
  creado_en timestamptz not null default now(),
  unique (plan_id, version)
);

create table procedencias (
  id uuid primary key default gen_random_uuid(),
  fuente text not null check (fuente in ('oficial', 'secundaria', 'estimado')),
  url text
);

create table paradas (
  id uuid primary key default gen_random_uuid(),
  -- Identificador tal como lo asigna la aplicación (Parada.id del modelo en
  -- src/lib/plan/tipos.ts); único dentro de su versión, no globalmente.
  id_externo text not null,
  plan_version_id uuid not null references plan_versiones (id) on delete cascade,
  dia_index integer not null check (dia_index >= 0),
  franja_id text not null,
  sitio_nombre text not null,
  sitio_lat double precision not null,
  sitio_lon double precision not null,
  duracion_min numeric not null check (duracion_min > 0),
  prioridad integer not null check (prioridad between 0 and 100),
  procedencia_id uuid not null references procedencias (id),
  unique (plan_version_id, id_externo)
);

create index paradas_plan_version_idx on paradas (plan_version_id, dia_index);

create table visitas (
  id uuid primary key default gen_random_uuid(),
  parada_id uuid not null references paradas (id) on delete cascade,
  visitado_en timestamptz not null default now()
);

create table trabajos (
  id uuid primary key default gen_random_uuid(),
  plan_id text references planes (id) on delete cascade,
  tipo text not null check (tipo in ('generacion', 'recalculo', 'guia')),
  estado text not null default 'encolado' check (
    estado in ('encolado', 'en-curso', 'pausado-por-cuota', 'completado', 'fallido', 'caducado')
  ),
  prioridad integer not null default 0,
  etapa text,
  motivo text,
  reintento_no_antes_de timestamptz,
  tomado_por text,
  tomado_hasta timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table cache_sitios (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  datos jsonb not null,
  actualizado_en timestamptz not null default now()
);

create table cache_fichas (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  datos jsonb not null,
  procedencia_id uuid references procedencias (id),
  actualizado_en timestamptz not null default now()
);

create table tipos_cambio (
  moneda text not null,
  fecha_referencia date not null,
  tasa_eur numeric not null,
  primary key (moneda, fecha_referencia)
);

create table uso_suscripcion (
  id uuid primary key default gen_random_uuid(),
  familia text not null check (familia in ('opus', 'sonnet')),
  ventana text not null check (ventana in ('five_hour', 'seven_day')),
  used_percentage numeric not null,
  resets_at timestamptz not null,
  leido_en timestamptz not null default now()
);

create table salud (
  id uuid primary key default gen_random_uuid(),
  origen text not null,
  registrado_en timestamptz not null default now()
);

alter table planes enable row level security;
alter table plan_versiones enable row level security;
alter table procedencias enable row level security;
alter table paradas enable row level security;
alter table visitas enable row level security;
alter table trabajos enable row level security;
alter table cache_sitios enable row level security;
alter table cache_fichas enable row level security;
alter table tipos_cambio enable row level security;
alter table uso_suscripcion enable row level security;
alter table salud enable row level security;

-- Sin GRANT, PostgREST no expone la tabla y responde 404 -tanto para una
-- tabla protegida como para una que no existe-, lo que hace indistinguible
-- "denegado por RLS" de "no hay tabla" en el propio test de persistencia-ac2.
-- El GRANT deja el 404 solo para lo que de verdad no existe; la denegación
-- real la sigue haciendo RLS, que no tiene ni una política para anon ni
-- para authenticated en ninguna tabla.
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
