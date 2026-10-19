#!/usr/bin/env bash
# sal-ac2 (cp-sco-01 del ac47): comprueba estado_relleno() contra una base
# Postgres real con las migraciones aplicadas, por psql directo y sin
# PostgREST. Todo ocurre dentro de una transacción que acaba en rollback:
# la base se queda como estaba, así que se puede lanzar también contra una
# que ya tenga datos (por eso los asertos son deltas y no valores absolutos).
#
# Uso: BD_URL=postgresql://... bash scripts/verificar-bd-prueba.sh [relleno|cupo|permisos|lugares|obsoleto|orden]
# Sin argumento comprueba estado_relleno() y estado_relleno_motivos(); `cupo` y `permisos` son los casos
# del controlador de cupo de Google (ctl-ac1 y ctl-ac2).
set -euo pipefail

if [ -z "${BD_URL:-}" ]; then
  echo "Falta BD_URL (URL de la base de prueba)." >&2
  exit 2
fi

modo="${1:-relleno}"

relleno() {
psql "$BD_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
begin;
set local search_path = viajes_planner, public, extensions;

create temp table _antes as select viajes_planner.estado_relleno() as j;
create temp table _antes_motivos as select viajes_planner.estado_relleno_motivos() as j;

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
  if (select count(*) from _antes_motivos, jsonb_object_keys(j)) <> 7 then
    raise exception 'estado_relleno_motivos() no devuelve exactamente 7 claves';
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
-- Tres no-resueltas (una con categoría que descarta el topónimo, otra con
-- una que no, otra sin categoría como las filas antiguas) y una sin intentar.
insert into paradas (id_externo, plan_version_id, dia_index, franja_id, nombre, lat, lon,
                     descripcion, duracion_min, prioridad, procedencia_id, motivo, resolucion)
select m.id_externo, ver.id, 0, 'manana', m.id_externo, 0, 0, '', 30, 50, proc.id, m.motivo, m.resolucion
from ver, proc, (values
  ('vbd-p1', 'Ideal con niños', '{"estado": "no-resuelta", "intentado_en": "2026-10-01T00:00:00Z", "categoria_motivo": "sin-candidatos"}'::jsonb),
  ('vbd-p2', 'Vistas al río', '{"estado": "no-resuelta", "intentado_en": "2026-10-01T00:00:00Z", "categoria_motivo": "tipo-incompatible"}'::jsonb),
  ('vbd-p3', '', '{"estado": "no-resuelta", "intentado_en": "2026-10-01T00:00:00Z"}'::jsonb),
  ('vbd-p4', null, null)
) as m(id_externo, motivo, resolucion);

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

-- estado_relleno_motivos(): siete enteros, el desglose suma las no-resueltas
-- y los deltas cuadran con las cuatro paradas sembradas.
do $$
declare
  v_antes jsonb;
  v_despues jsonb := viajes_planner.estado_relleno_motivos();
  v_relleno jsonb := viajes_planner.estado_relleno();
  v_delta_no_resueltas int;
begin
  select j into v_antes from _antes_motivos;
  select (v_relleno ->> 'paradas_no_resueltas')::int - (j ->> 'paradas_no_resueltas')::int into v_delta_no_resueltas from _antes;
  if (select count(*) from jsonb_object_keys(v_despues)) <> 7 then
    raise exception 'estado_relleno_motivos() no devuelve exactamente 7 claves';
  end if;
  if exists (select 1 from jsonb_each(v_despues) where jsonb_typeof(value) <> 'number') then
    raise exception 'estado_relleno_motivos() devuelve un valor que no es numérico';
  end if;
  if v_delta_no_resueltas <> 3 then
    raise exception 'paradas_no_resueltas debía subir 3';
  end if;
  if (v_despues ->> 'paradas_no_resueltas_sin_candidatos')::int - (v_antes ->> 'paradas_no_resueltas_sin_candidatos')::int <> 1 then
    raise exception 'paradas_no_resueltas_sin_candidatos debía subir 1';
  end if;
  if (v_despues ->> 'paradas_no_resueltas_tipo_incompatible')::int - (v_antes ->> 'paradas_no_resueltas_tipo_incompatible')::int <> 1 then
    raise exception 'paradas_no_resueltas_tipo_incompatible debía subir 1';
  end if;
  if (v_despues ->> 'paradas_no_resueltas_motivo_desconocido')::int - (v_antes ->> 'paradas_no_resueltas_motivo_desconocido')::int <> 1 then
    raise exception 'paradas_no_resueltas_motivo_desconocido debía subir 1';
  end if;
  if (v_relleno ->> 'paradas_no_resueltas')::int <>
     (v_despues ->> 'paradas_no_resueltas_sin_candidatos')::int + (v_despues ->> 'paradas_no_resueltas_fuera_de_caja')::int
     + (v_despues ->> 'paradas_no_resueltas_nombre_distinto')::int + (v_despues ->> 'paradas_no_resueltas_tipo_incompatible')::int
     + (v_despues ->> 'paradas_no_resueltas_motivo_desconocido')::int then
    raise exception 'el desglose por motivo no suma paradas_no_resueltas';
  end if;
  if (v_despues ->> 'paradas_con_toponimo')::int - (v_antes ->> 'paradas_con_toponimo')::int <> 3 then
    raise exception 'paradas_con_toponimo debía subir 3 (4 paradas menos la sin-candidatos)';
  end if;
  if (v_despues ->> 'paradas_sin_intentar_ultima_version')::int - (v_antes ->> 'paradas_sin_intentar_ultima_version')::int <> 1 then
    raise exception 'paradas_sin_intentar_ultima_version debía subir 1';
  end if;
  if v_despues::text ~* 'Ideal con ni|Vistas al r|@|[0-9a-f]{8}-[0-9a-f]{4}|vbd-' then
    raise exception 'La salida de estado_relleno_motivos() contiene texto de los datos';
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
do $$
begin
  set local role anon;
  perform viajes_planner.estado_relleno_motivos();
  raise exception 'anon pudo ejecutar estado_relleno_motivos()';
exception when insufficient_privilege then
  null;
end $$;
do $$
begin
  set local role authenticated;
  perform viajes_planner.estado_relleno_motivos();
  raise exception 'authenticated pudo ejecutar estado_relleno_motivos()';
exception when insufficient_privilege then
  null;
end $$;

rollback;
SQL

echo "OK: estado_relleno() cumple cp-sco-01 (26 claves numéricas, contadores nuevos, sin texto, sin acceso anon/authenticated)."
echo "OK: estado_relleno_motivos() da 7 enteros que cuadran con las no-resueltas, sin texto y sin acceso anon/authenticated."
}

# ctl-ac1: las reservas concurrentes no pasan de los topes. Aquí no hay
# transacción con rollback porque la concurrencia exige conexiones distintas
# que hagan commit; por eso exige consumo vacío en los SKU que usa (no pisa
# datos reales) y limpia lo suyo al salir.
cupo() {
  # Globales: el trap de salida corre cuando las variables locales ya no existen.
  usuario_a="00000000-0000-4000-8000-0000000000a1"
  usuario_b="00000000-0000-4000-8000-0000000000b2"
  local hoy
  hoy=$(psql "$BD_URL" -tAc "select (now() at time zone 'America/Los_Angeles')::date")
  if [ "$(psql "$BD_URL" -tAc "select count(*) from viajes_planner.consumo_google where sku in ('text_search_pro', 'ui_kit') and dia = '$hoy'")" != "0" ]; then
    echo "La base ya tiene consumo de hoy en text_search_pro o ui_kit: usa una base de prueba limpia." >&2
    exit 2
  fi
  limpiar() {
    psql "$BD_URL" -q -c "delete from viajes_planner.consumo_google_usuario where sku in ('ui_kit', 'prueba_prop');
      delete from viajes_planner.consumo_google where sku in ('text_search_pro', 'ui_kit', 'prueba_mes', 'prueba_prop');
      delete from viajes_planner.topes_google where sku in ('prueba_mes', 'prueba_prop');
      delete from auth.users where id in ('$usuario_a', '$usuario_b');" >/dev/null
  }
  trap limpiar EXIT
  psql "$BD_URL" -v ON_ERROR_STOP=1 -q -c "insert into auth.users (id) values ('$usuario_a'), ('$usuario_b');
    insert into viajes_planner.topes_google (sku, tope_dia, tope_mes, tope_usuario_dia) values ('prueba_mes', 10, 5, null);" >/dev/null

  local salida ok topes usados
  salida=$(seq 100 | xargs -P 20 -I{} psql "$BD_URL" -tAc "select viajes_planner.reservar_cupo_google('text_search_pro')")
  ok=$(grep -c '^ok$' <<<"$salida" || true)
  topes=$(grep -c '^tope-dia$' <<<"$salida" || true)
  usados=$(psql "$BD_URL" -tAc "select usados from viajes_planner.consumo_google where sku = 'text_search_pro' and dia = '$hoy'")
  [ "$ok" = "45" ] && [ "$topes" = "55" ] && [ "$usados" = "45" ] || {
    echo "cupo-concurrente: esperaba 45 ok, 55 tope-dia y 45 usados; salió $ok, $topes y $usados" >&2; exit 1; }

  # Límite mensual: el tope del mes es menor que el del día, así el caso no
  # depende de qué día del mes se ejecute.
  salida=$(seq 10 | xargs -P 5 -I{} psql "$BD_URL" -tAc "select viajes_planner.reservar_cupo_google('prueba_mes')")
  ok=$(grep -c '^ok$' <<<"$salida" || true)
  topes=$(grep -c '^tope-mes$' <<<"$salida" || true)
  [ "$ok" = "5" ] && [ "$topes" = "5" ] || { echo "tope-mes: esperaba 5 ok y 5 tope-mes; salió $ok y $topes" >&2; exit 1; }

  # Límite por usuario: la 81.ª del mismo usuario se corta y otro sigue pasando.
  salida=$(seq 81 | xargs -P 10 -I{} psql "$BD_URL" -tAc "select viajes_planner.reservar_cupo_google('ui_kit', '$usuario_a')")
  ok=$(grep -c '^ok$' <<<"$salida" || true)
  topes=$(grep -c '^tope-usuario$' <<<"$salida" || true)
  [ "$ok" = "80" ] && [ "$topes" = "1" ] || { echo "tope-usuario: esperaba 80 ok y 1 tope-usuario; salió $ok y $topes" >&2; exit 1; }
  [ "$(psql "$BD_URL" -tAc "select viajes_planner.reservar_cupo_google('ui_kit', '$usuario_b')")" = "ok" ] || {
    echo "tope-usuario: otro usuario debía seguir obteniendo ok" >&2; exit 1; }
  # Invariantes 1 y 2 con secuencias aleatorias (semilla fija, así un fallo se
  # reproduce): una reserva es ok solo si sube exactamente 1 los contadores de
  # su sku y de su usuario, y cualquier otra respuesta no toca ninguno.
  psql "$BD_URL" -v ON_ERROR_STOP=1 -q -c "insert into viajes_planner.topes_google values ('prueba_prop', 20, 25, 7)" >/dev/null
  psql "$BD_URL" -v ON_ERROR_STOP=1 -q <<SQL
select setseed(0.42);
do \$\$
declare
  usuarios uuid[] := array['$usuario_a', '$usuario_b', null]::uuid[];
  u uuid; r text; i integer;
  dia_antes integer; dia_despues integer; usr_antes integer; usr_despues integer;
begin
  for i in 1..200 loop
    u := usuarios[1 + floor(random() * 3)::int];
    select coalesce(sum(usados), 0) into dia_antes from viajes_planner.consumo_google where sku = 'prueba_prop';
    select coalesce(sum(usados), 0) into usr_antes from viajes_planner.consumo_google_usuario where sku = 'prueba_prop' and usuario_id = u;
    r := viajes_planner.reservar_cupo_google('prueba_prop', u);
    select coalesce(sum(usados), 0) into dia_despues from viajes_planner.consumo_google where sku = 'prueba_prop';
    select coalesce(sum(usados), 0) into usr_despues from viajes_planner.consumo_google_usuario where sku = 'prueba_prop' and usuario_id = u;
    if r = 'ok' then
      if dia_despues <> dia_antes + 1 or (u is not null and usr_despues <> usr_antes + 1) then
        raise exception 'ok no subió exactamente 1 (iteración %)', i;
      end if;
    elsif dia_despues <> dia_antes or usr_despues <> usr_antes then
      raise exception '% cambió un contador (iteración %)', r, i;
    end if;
    if dia_despues > 20 or usr_despues > 7 then
      raise exception 'tope superado (iteración %)', i;
    end if;
  end loop;
  if (select sum(usados) from viajes_planner.consumo_google where sku = 'prueba_prop') <> 20 then
    raise exception 'con 200 intentos y tope 20 debían gastarse exactamente 20';
  end if;
end \$\$;
SQL
  echo "OK: el controlador de cupo no pasa de los topes (día, mes y usuario) con 20 conexiones en paralelo."
}

# ctl-ac2: anon y authenticated no llegan ni a las funciones ni a las tablas.
permisos() {
  local rol
  for rol in anon authenticated; do
    psql "$BD_URL" -v ON_ERROR_STOP=1 -q <<SQL
begin;
set local role $rol;
set local request.jwt.claims = '{"role": "$rol"}';
do \$\$
declare consulta text;
begin
  foreach consulta in array array[
    'select viajes_planner.reservar_cupo_google(''ui_kit'')',
    'select viajes_planner.consumo_google_resumen()',
    'select * from viajes_planner.consumo_google',
    'select * from viajes_planner.consumo_google_usuario',
    'select * from viajes_planner.topes_google',
    'insert into viajes_planner.topes_google values (''x'', 1, 1, null)'
  ] loop
    begin
      execute consulta;
      raise exception '$rol pudo ejecutar: %', consulta;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end \$\$;
rollback;
SQL
  done
  echo "OK: anon y authenticated reciben permission denied en las funciones y tablas del cupo."
}

# cas-ac3: lugares_google no guarda nada de Google salvo el place_id, y el
# navegador (authenticated) solo lee clave y estado.
lugares() {
  local columnas
  columnas=$(psql "$BD_URL" -tAc "select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'viajes_planner' and table_name = 'lugares_google'")
  if [ "$columnas" != "clave,comprobado_en,estado,place_id" ]; then
    echo "lugares_google tiene columnas inesperadas: $columnas" >&2
    exit 1
  fi
  psql "$BD_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
begin;
set local search_path = viajes_planner, public, extensions;
insert into lugares_google (clave, place_id, estado, comprobado_en) values ('osm:node/vbd-1', 'place-id-de-control', 'casado', now());
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';
select clave, estado from lugares_google limit 1;
do $$
begin
  begin
    perform place_id from viajes_planner.lugares_google;
    raise exception 'authenticated pudo leer place_id';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into viajes_planner.lugares_google (clave, estado, comprobado_en) values ('x', 'error', now());
    raise exception 'authenticated pudo escribir en lugares_google';
  exception when insufficient_privilege then
    null;
  end;
end $$;
rollback;
SQL
  echo "OK: lugares_google tiene 4 columnas y authenticated solo lee clave y estado."
}

# obs-ac1 y obs-ac4 (#240): registrar_obsoleto_google aguanta la concurrencia
# (una marca por terna, cinco por usuario y día) y anon/authenticated no llegan
# a la función ni a la tabla. Hace commit en conexiones distintas, así que
# limpia lo suyo al salir.
obsoleto() {
  usuario_a="00000000-0000-4000-8000-0000000000c1"
  usuario_b="00000000-0000-4000-8000-0000000000c2"
  limpiar() {
    psql "$BD_URL" -q -c "delete from auth.users where id in ('$usuario_a', '$usuario_b');" >/dev/null
  }
  trap limpiar EXIT
  psql "$BD_URL" -v ON_ERROR_STOP=1 -q -c "insert into auth.users (id) values ('$usuario_a'), ('$usuario_b');" >/dev/null

  local salida ok repetidos topes filas
  salida=$(seq 20 | xargs -P 10 -I{} psql "$BD_URL" -tAc "select viajes_planner.registrar_obsoleto_google('$usuario_a', 'osm:node/vbd-misma')")
  ok=$(grep -c '^ok$' <<<"$salida" || true)
  repetidos=$(grep -c '^repetido$' <<<"$salida" || true)
  filas=$(psql "$BD_URL" -tAc "select count(*) from viajes_planner.marcas_obsoleto_google where usuario_id = '$usuario_a'")
  [ "$ok" = "1" ] && [ "$repetidos" = "19" ] && [ "$filas" = "1" ] || {
    echo "obsoleto-misma-terna: esperaba 1 ok, 19 repetido y 1 fila; salió $ok, $repetidos y $filas" >&2; exit 1; }

  salida=$(seq 10 | xargs -P 10 -I{} psql "$BD_URL" -tAc "select viajes_planner.registrar_obsoleto_google('$usuario_b', 'osm:node/vbd-' || {})")
  ok=$(grep -c '^ok$' <<<"$salida" || true)
  topes=$(grep -c '^tope-usuario$' <<<"$salida" || true)
  filas=$(psql "$BD_URL" -tAc "select count(*) from viajes_planner.marcas_obsoleto_google where usuario_id = '$usuario_b'")
  [ "$ok" = "5" ] && [ "$topes" = "5" ] && [ "$filas" = "5" ] || {
    echo "obsoleto-tope-usuario: esperaba 5 ok, 5 tope-usuario y 5 filas; salió $ok, $topes y $filas" >&2; exit 1; }

  local rol
  for rol in anon authenticated; do
    psql "$BD_URL" -v ON_ERROR_STOP=1 -q <<SQL
begin;
set local role $rol;
set local request.jwt.claims = '{"role": "$rol"}';
do \$\$
declare consulta text;
begin
  foreach consulta in array array[
    'select viajes_planner.registrar_obsoleto_google(''$usuario_a'', ''x'')',
    'select * from viajes_planner.marcas_obsoleto_google',
    'insert into viajes_planner.marcas_obsoleto_google (usuario_id, clave, dia) values (''$usuario_a'', ''x'', current_date)'
  ] loop
    begin
      execute consulta;
      raise exception '$rol pudo ejecutar: %', consulta;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end \$\$;
rollback;
SQL
  done
  [ "$(psql "$BD_URL" -tAc "select relrowsecurity from pg_class where oid = 'viajes_planner.marcas_obsoleto_google'::regclass")" = "t" ] || {
    echo "marcas_obsoleto_google sin RLS" >&2; exit 1; }
  echo "OK: registrar_obsoleto_google da 1 ok por terna y 5 por usuario con concurrencia, y anon/authenticated no llegan."
}

# dat-ac2..dat-ac5: reordenar_dia_plan contra Postgres real. Siembra un plan
# propio (id vbd-orden-*), lo limpia al salir y solo cuenta filas de ese plan,
# así que vale contra una base con datos.
orden() {
  local plan="vbd-orden-$$"
  limpiar() { psql "$BD_URL" -q -c "delete from viajes_planner.planes where id like 'vbd-orden-%'" >/dev/null 2>&1 || true; }
  trap limpiar EXIT
  psql "$BD_URL" -v ON_ERROR_STOP=1 -q <<SQL
set search_path = viajes_planner, public, extensions;
insert into planes (id, destino) values ('$plan', 'Destino de control');
insert into plan_versiones (plan_id, version, personas, dias) values ('$plan', 1, 2,
  '[{"fecha": "2026-11-07", "franjas": [{"id": "manana"}, {"id": "comida"}, {"id": "tarde"}]},
    {"fecha": "2026-11-08", "franjas": [{"id": "manana"}]}]'::jsonb);
with proc as (insert into procedencias (fuente) values ('propuesto-sin-verificar') returning id),
     ver as (select id from plan_versiones where plan_id = '$plan' and version = 1)
insert into paradas (id_externo, plan_version_id, dia_index, franja_id, nombre, lat, lon, descripcion, duracion_min, prioridad, procedencia_id)
select m.ide, ver.id, m.dia, m.franja, m.ide, 0, 0, '', 30, 50, proc.id
  from ver, proc, (values ('p1', 0, 'manana'), ('p2', 0, 'manana'), ('p3', 0, 'comida'), ('p4', 0, 'tarde'), ('p5', 0, 'tarde'), ('q1', 1, 'manana')) as m(ide, dia, franja);
SQL
  local ok='[{"id":"p2","franja_id":"manana"},{"id":"p1","franja_id":"manana"},{"id":"p3","franja_id":"comida"},{"id":"p5","franja_id":"tarde"},{"id":"p4","franja_id":"tarde"}]'
  local filas_antes filas_despues
  filas_antes() { psql "$BD_URL" -tAc "select (select count(*) from viajes_planner.plan_versiones where plan_id = '$plan') || '/' || (select count(*) from viajes_planner.paradas pa join viajes_planner.plan_versiones pv on pv.id = pa.plan_version_id where pv.plan_id = '$plan')"; }
  rechaza() {
    local esperado="$1" base="$2" dia="$3" cuerpo="$4" antes despues salida
    antes=$(filas_antes)
    salida=$(psql "$BD_URL" -tAc "select * from viajes_planner.reordenar_dia_plan('$plan', $base, $dia, '$cuerpo'::jsonb)" 2>&1 || true)
    despues=$(filas_antes)
    grep -q "$esperado" <<<"$salida" || { echo "orden: esperaba '$esperado' y salió: $salida" >&2; exit 1; }
    [ "$antes" = "$despues" ] || { echo "orden: una llamada rechazada dejó filas ($antes -> $despues)" >&2; exit 1; }
  }
  rechaza version-desfasada 7 0 "$ok"
  rechaza orden-invalido 1 0 '[{"id":"p1","franja_id":"manana"},{"id":"p1","franja_id":"manana"},{"id":"p3","franja_id":"comida"},{"id":"p4","franja_id":"tarde"},{"id":"p5","franja_id":"tarde"}]'
  rechaza orden-invalido 1 0 '[{"id":"p1","franja_id":"manana"},{"id":"p2","franja_id":"manana"},{"id":"p3","franja_id":"comida"},{"id":"p4","franja_id":"tarde"}]'
  rechaza orden-invalido 1 0 '[{"id":"p1","franja_id":"manana"},{"id":"p2","franja_id":"manana"},{"id":"p3","franja_id":"comida"},{"id":"p4","franja_id":"tarde"},{"id":"q1","franja_id":"tarde"}]'
  rechaza orden-invalido 1 0 '[{"id":"p4","franja_id":"tarde"},{"id":"p5","franja_id":"tarde"},{"id":"p1","franja_id":"manana"},{"id":"p2","franja_id":"manana"},{"id":"p3","franja_id":"comida"}]'
  rechaza orden-invalido 1 0 '[{"id":"p1","franja_id":"manana"},{"id":"p2","franja_id":"manana"},{"id":"p3","franja_id":"noche"},{"id":"p4","franja_id":"tarde"},{"id":"p5","franja_id":"tarde"}]'
  rechaza orden-invalido 1 5 "$ok"

  # Dos llamadas a la vez con la misma base: una crea la versión 2 y la otra pierde.
  # mktemp -d: en el CI no hay TMPDIR definida y con `set -u` rompía aquí.
  local carpeta; carpeta=$(mktemp -d)
  local a="$carpeta/orden-a.txt" b="$carpeta/orden-b.txt"
  psql "$BD_URL" -tAc "select version from viajes_planner.reordenar_dia_plan('$plan', 1, 0, '$ok'::jsonb)" >"$a" 2>&1 &
  local pa=$!
  psql "$BD_URL" -tAc "select version from viajes_planner.reordenar_dia_plan('$plan', 1, 0, '[{\"id\":\"p1\",\"franja_id\":\"manana\"},{\"id\":\"p2\",\"franja_id\":\"manana\"},{\"id\":\"p3\",\"franja_id\":\"comida\"},{\"id\":\"p4\",\"franja_id\":\"tarde\"},{\"id\":\"p5\",\"franja_id\":\"tarde\"}]'::jsonb)" >"$b" 2>&1 &
  local pb=$!
  wait "$pa" || true; wait "$pb" || true
  [ "$(cat "$a" "$b" | grep -c '^2$')" = "1" ] && [ "$(cat "$a" "$b" | grep -c 'version-desfasada')" = "1" ] \
    && [ "$(psql "$BD_URL" -tAc "select count(*) from viajes_planner.plan_versiones where plan_id = '$plan'")" = "2" ] || {
    echo "orden-concurrencia: esperaba una versión 2 y un version-desfasada; salió: $(cat "$a" "$b")" >&2; exit 1; }

  # La versión 2 conserva todo salvo el orden del día 0 (una de las dos llamadas ganó):
  # comprobamos las invariantes sin depender de cuál.
  psql "$BD_URL" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
declare v1 uuid; v2 uuid;
begin
  select id into v1 from viajes_planner.plan_versiones where plan_id = '$plan' and version = 1;
  select id into v2 from viajes_planner.plan_versiones where plan_id = '$plan' and version = 2;
  if exists (select 1 from viajes_planner.paradas where plan_version_id = v1 and orden is not null) then
    raise exception 'la version 1 cambio';
  end if;
  if (select array_agg(id_externo order by id_externo) from viajes_planner.paradas where plan_version_id = v2)
     is distinct from (select array_agg(id_externo order by id_externo) from viajes_planner.paradas where plan_version_id = v1) then
    raise exception 'el multiconjunto de id_externo cambio';
  end if;
  if (select array_agg(orden order by orden) from viajes_planner.paradas where plan_version_id = v2 and dia_index = 0) <> array[0,1,2,3,4] then
    raise exception 'orden no es 0..n-1 sin huecos';
  end if;
  if exists (select 1 from viajes_planner.paradas where plan_version_id = v2 and dia_index = 1 and orden is not null) then
    raise exception 'el dia 1 no deberia tener orden';
  end if;
end \$\$;
SQL

  # Clonar de nuevo (como hace sustituir) conserva orden.
  psql "$BD_URL" -v ON_ERROR_STOP=1 -q -c "select * from viajes_planner.clonar_version_plan('$plan')" >/dev/null
  [ "$(psql "$BD_URL" -tAc "select count(*) from viajes_planner.paradas pa join viajes_planner.plan_versiones pv on pv.id = pa.plan_version_id where pv.plan_id = '$plan' and pv.version = 3 and pa.dia_index = 0 and pa.orden is not null")" = "5" ] || {
    echo "orden: clonar_version_plan no copia orden" >&2; exit 1; }

  # Permisos: solo service_role ejecuta la RPC.
  local rol esperado
  for rol in anon authenticated service_role; do
    esperado=f; [ "$rol" = "service_role" ] && esperado=t
    [ "$(psql "$BD_URL" -tAc "select has_function_privilege('$rol', 'viajes_planner.reordenar_dia_plan(text, integer, integer, jsonb)', 'execute')")" = "$esperado" ] || {
      echo "orden-permisos: $rol con execute distinto de $esperado" >&2; exit 1; }
  done
  echo "OK: reordenar_dia_plan crea la version N+1 con el dia reordenado, rechaza lo invalido sin dejar filas, resuelve la concurrencia con una sola ganadora y solo service_role la ejecuta."
}

case "$modo" in
  relleno) relleno ;;
  cupo) cupo ;;
  permisos) permisos ;;
  lugares) lugares ;;
  obsoleto) obsoleto ;;
  orden) orden ;;
  *) echo "Modo desconocido: $modo (relleno, cupo, permisos, lugares, obsoleto u orden)" >&2; exit 2 ;;
esac
