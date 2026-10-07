#!/usr/bin/env bash
# sal-ac2 (cp-sco-01 del ac47): comprueba estado_relleno() contra una base
# Postgres real con las migraciones aplicadas, por psql directo y sin
# PostgREST. Todo ocurre dentro de una transacción que acaba en rollback:
# la base se queda como estaba, así que se puede lanzar también contra una
# que ya tenga datos (por eso los asertos son deltas y no valores absolutos).
#
# Uso: BD_URL=postgresql://... bash scripts/verificar-bd-prueba.sh
set -euo pipefail

if [ -z "${BD_URL:-}" ]; then
  echo "Falta BD_URL (URL de la base de prueba)." >&2
  exit 2
fi

psql "$BD_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
begin;
set local search_path = viajes_planner, public, extensions;

create temp table _antes as select viajes_planner.estado_relleno() as j;

-- Con las tablas vacías las claves valen 0 (ni null ni ausentes). Si la base
-- ya trae datos, este límite no se puede comprobar sin borrarlos: se avisa.
do $$
declare v_suma numeric;
begin
  select coalesce(sum((value)::numeric), 0) into v_suma from _antes, jsonb_each(j);
  if v_suma = 0 then
    if (select count(*) from _antes, jsonb_object_keys(j)) <> 26 then
      raise exception 'Con las tablas vacías no salen las 26 claves';
    end if;
  else
    raise notice 'Base con datos: el límite de tablas vacías no se comprueba';
  end if;
end $$;

insert into planes (id, destino) values
  ('vbd-multi', 'Destino de control uno'),
  ('vbd-una', 'Destino de control dos'),
  ('vbd-motivos', 'Destino de control tres');

insert into plan_versiones (plan_id, version, personas, dias, etapas) values
  ('vbd-multi', 1, 2, '[]'::jsonb, '[{"n": 1}, {"n": 2}]'::jsonb),
  ('vbd-una', 1, 2, '[]'::jsonb, null),
  ('vbd-una', 2, 2, '[]'::jsonb, '[]'::jsonb),
  ('vbd-motivos', 1, 2, '[]'::jsonb, null);

insert into trabajos (plan_id, tipo, estado, criterios, inviable) values
  ('vbd-multi', 'generacion', 'completado', '{}'::jsonb, '{"razones": ["no caben"]}'::jsonb),
  ('vbd-una', 'generacion', 'completado', '{}'::jsonb, null);

with proc as (
  insert into procedencias (fuente) values ('propuesto-sin-verificar') returning id
), ver as (
  select id from plan_versiones where plan_id = 'vbd-motivos' and version = 1
)
insert into paradas (id_externo, plan_version_id, dia_index, franja_id, sitio_nombre, sitio_lat, sitio_lon,
                     duracion_min, prioridad, procedencia_id, motivo)
select m.id_externo, ver.id, 0, 'manana', m.id_externo, 0, 0, 30, 50, proc.id, m.motivo
from ver, proc, (values
  ('vbd-p1', 'Ideal con niños'),
  ('vbd-p2', 'Vistas al río'),
  ('vbd-p3', ''),
  ('vbd-p4', null)
) as m(id_externo, motivo);

do $$
declare
  v_antes jsonb;
  v_despues jsonb := viajes_planner.estado_relleno();
  v_texto text;
begin
  select j into v_antes from _antes;
  if (select count(*) from jsonb_object_keys(v_despues)) <> 26 then
    raise exception 'estado_relleno() no devuelve exactamente 26 claves';
  end if;
  if exists (select 1 from jsonb_each(v_despues) where jsonb_typeof(value) <> 'number') then
    raise exception 'estado_relleno() devuelve un valor que no es numérico';
  end if;
  if (v_despues ->> 'versiones_multiciudad')::int - (v_antes ->> 'versiones_multiciudad')::int <> 1 then
    raise exception 'versiones_multiciudad debía subir 1';
  end if;
  if (v_despues ->> 'trabajos_inviables')::int - (v_antes ->> 'trabajos_inviables')::int <> 1 then
    raise exception 'trabajos_inviables debía subir 1';
  end if;
  if (v_despues ->> 'paradas_con_motivo')::int - (v_antes ->> 'paradas_con_motivo')::int <> 2 then
    raise exception 'paradas_con_motivo debía subir 2';
  end if;
  if (v_despues ->> 'paradas_total')::int - (v_antes ->> 'paradas_total')::int <> 4 then
    raise exception 'paradas_total debía subir 4';
  end if;
  v_texto := v_despues::text;
  if v_texto ~* 'Ideal con ni|Vistas al r|@|[0-9a-f]{8}-[0-9a-f]{4}|vbd-' then
    raise exception 'La salida de estado_relleno() contiene texto de los datos';
  end if;
end $$;

-- anon y authenticated no pueden leer recuentos de toda la base. El role se
-- restaura solo: set local dentro de un bloque con excepción se deshace con él.
do $$
begin
  set local role anon;
  perform viajes_planner.estado_relleno();
  raise exception 'anon pudo ejecutar estado_relleno()';
exception when insufficient_privilege then
  null;
end $$;
do $$
begin
  set local role authenticated;
  perform viajes_planner.estado_relleno();
  raise exception 'authenticated pudo ejecutar estado_relleno()';
exception when insufficient_privilege then
  null;
end $$;

rollback;
SQL

echo "OK: estado_relleno() cumple cp-sco-01 (26 claves numéricas, contadores nuevos, sin texto, sin acceso anon/authenticated)."
