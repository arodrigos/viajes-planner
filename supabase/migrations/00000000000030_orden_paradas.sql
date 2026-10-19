-- Bloque orden-en-datos: el orden de las paradas dentro de un día se guarda.
-- 1) paradas.orden (nulo = el orden de siempre, por franja e id_externo): sin
--    una columna explícita no hay forma de reordenar dentro de una franja.
-- 2) clonar_version_plan pasa a copiar orden; misma firma, así que se redefine
--    sin tocar permisos ni quien la llama.
-- 3) reordenar_dia_plan crea la versión siguiente con un día reordenado en una
--    sola transacción: bloquea el plan, comprueba la versión base y valida la
--    permutación. Clonar por PostgREST tardaba más de 5 s (025).
set search_path = viajes_planner, public, extensions;

alter table paradas add column orden integer check (orden is null or orden >= 0);

create or replace function clonar_version_plan(p_plan_id text)
returns table (version integer, plan_version_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_origen viajes_planner.plan_versiones%rowtype;
  v_nueva_id uuid := gen_random_uuid();
begin
  select * into v_origen
    from viajes_planner.plan_versiones pv
   where pv.plan_id = p_plan_id
   order by pv.version desc
   limit 1;
  if not found then
    return;
  end if;

  insert into viajes_planner.plan_versiones
    (id, plan_id, version, personas, dias, avisos, recomendaciones, etapas, traslados, eventos, eventos_intentados_en)
  values
    (v_nueva_id, v_origen.plan_id, v_origen.version + 1, v_origen.personas, v_origen.dias, v_origen.avisos,
     v_origen.recomendaciones, v_origen.etapas, v_origen.traslados, v_origen.eventos, v_origen.eventos_intentados_en);

  -- Una procedencia y una parada nuevas por cada parada vieja, con el id
  -- viejo como puente para colgar las alternativas de la copia.
  create temporary table mapa_paradas on commit drop as
    select p.id as id_viejo, gen_random_uuid() as id_nuevo, gen_random_uuid() as procedencia_nueva, p.procedencia_id as procedencia_vieja
      from viajes_planner.paradas p
     where p.plan_version_id = v_origen.id;

  insert into viajes_planner.procedencias (id, fuente, url)
    select m.procedencia_nueva, pr.fuente, pr.url
      from mapa_paradas m
      join viajes_planner.procedencias pr on pr.id = m.procedencia_vieja;

  insert into viajes_planner.paradas
    (id, id_externo, plan_version_id, dia_index, franja_id, nombre, lat, lon, duracion_min, prioridad, procedencia_id,
     descripcion, categoria, lugar, foto, resolucion, foto_intentada_en, alternativas_intentadas_en, motivo, coste,
     guia, curiosidades, guia_intentada_en, guia_formato, orden)
    select m.id_nuevo, p.id_externo, v_nueva_id, p.dia_index, p.franja_id, p.nombre, p.lat, p.lon, p.duracion_min, p.prioridad,
           m.procedencia_nueva, p.descripcion, p.categoria, p.lugar, p.foto, p.resolucion, p.foto_intentada_en,
           p.alternativas_intentadas_en, p.motivo, p.coste, p.guia, p.curiosidades, p.guia_intentada_en, p.guia_formato, p.orden
      from mapa_paradas m
      join viajes_planner.paradas p on p.id = m.id_viejo;

  insert into viajes_planner.paradas_alternativas
    (parada_id, origen, nombre, descripcion, motivo, duracion_min, categoria, lat, lon, lugar, foto,
     guia, curiosidades, guia_intentada_en, guia_formato, motivo_parada, coste_parada)
    select m.id_nuevo, a.origen, a.nombre, a.descripcion, a.motivo, a.duracion_min, a.categoria, a.lat, a.lon, a.lugar, a.foto,
           a.guia, a.curiosidades, a.guia_intentada_en, a.guia_formato, a.motivo_parada, a.coste_parada
      from mapa_paradas m
      join viajes_planner.paradas_alternativas a on a.parada_id = m.id_viejo
     order by a.creado_en, a.id;

  return query select v_origen.version + 1, v_nueva_id;
end;
$$;

create function reordenar_dia_plan(p_plan_id text, p_version_base integer, p_dia_index integer, p_orden jsonb)
returns table (version integer, plan_version_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_origen viajes_planner.plan_versiones%rowtype;
  v_franjas text[];
  v_ids_dia text[];
  v_n integer;
  v_nueva_version integer;
  v_nueva_id uuid;
begin
  -- El bloqueo serializa dos reordenaciones del mismo plan; frente a una
  -- sustitución, que clona sin bloquear, cierra la carrera unique (plan_id, version).
  perform 1 from viajes_planner.planes pl where pl.id = p_plan_id for update;
  if not found then
    raise exception 'orden-invalido';
  end if;

  select * into v_origen
    from viajes_planner.plan_versiones pv
   where pv.plan_id = p_plan_id
   order by pv.version desc
   limit 1;
  if not found or v_origen.version <> p_version_base then
    raise exception 'version-desfasada';
  end if;

  if p_orden is null or jsonb_typeof(p_orden) <> 'array' or jsonb_array_length(p_orden) = 0
     or p_dia_index is null or p_dia_index < 0 or p_dia_index >= jsonb_array_length(v_origen.dias) then
    raise exception 'orden-invalido';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_orden) e
     where jsonb_typeof(e) <> 'object'
        or jsonb_typeof(e -> 'id') <> 'string'
        or jsonb_typeof(e -> 'franja_id') <> 'string'
  ) then
    raise exception 'orden-invalido';
  end if;

  select coalesce(array_agg(f ->> 'id' order by n), '{}') into v_franjas
    from jsonb_array_elements(v_origen.dias -> p_dia_index -> 'franjas') with ordinality as t(f, n);

  select coalesce(array_agg(pa.id_externo), '{}') into v_ids_dia
    from viajes_planner.paradas pa
   where pa.plan_version_id = v_origen.id and pa.dia_index = p_dia_index;

  v_n := jsonb_array_length(p_orden);
  -- Permutación exacta: mismo número, sin repetidos y todos del día.
  if v_n <> coalesce(array_length(v_ids_dia, 1), 0)
     or (select count(distinct e ->> 'id') from jsonb_array_elements(p_orden) e) <> v_n
     or exists (select 1 from jsonb_array_elements(p_orden) e where not ((e ->> 'id') = any (v_ids_dia)))
     or exists (select 1 from jsonb_array_elements(p_orden) e where not ((e ->> 'franja_id') = any (v_franjas)))
  then
    raise exception 'orden-invalido';
  end if;
  -- La secuencia de índices de franja no decrece, como en horario.ts y paseo.ts.
  if exists (
    select 1 from (
      select array_position(v_franjas, e ->> 'franja_id') as idx,
             lag(array_position(v_franjas, e ->> 'franja_id')) over (order by n) as previo
        from jsonb_array_elements(p_orden) with ordinality as t(e, n)
    ) s
    where s.previo is not null and s.idx < s.previo
  ) then
    raise exception 'orden-invalido';
  end if;

  select c.version, c.plan_version_id into v_nueva_version, v_nueva_id
    from viajes_planner.clonar_version_plan(p_plan_id) c;

  update viajes_planner.paradas pa
     set orden = x.n - 1, franja_id = x.franja_id
    from (
      select e ->> 'id' as id, e ->> 'franja_id' as franja_id, n
        from jsonb_array_elements(p_orden) with ordinality as t(e, n)
    ) x
   where pa.plan_version_id = v_nueva_id and pa.dia_index = p_dia_index and pa.id_externo = x.id;

  return query select v_nueva_version, v_nueva_id;
end;
$$;

revoke execute on function viajes_planner.reordenar_dia_plan(text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function viajes_planner.reordenar_dia_plan(text, integer, integer, jsonb) to service_role;
