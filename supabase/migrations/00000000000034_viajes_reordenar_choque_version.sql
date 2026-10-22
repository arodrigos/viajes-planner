-- Bloque orden-choque-version: reordenar_dia_plan traduce el choque con un
-- clon concurrente del trabajador (unique_violation) a 'version-desfasada'.
-- Misma firma y mismo cuerpo que la 030; solo cambia el subbloque del clon.
set search_path = viajes_planner, public, extensions;

create or replace function reordenar_dia_plan(p_plan_id text, p_version_base integer, p_dia_index integer, p_orden jsonb)
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

  -- Un clon del trabajador no bloquea el plan: si confirma la versión N+1
  -- entre la lectura de arriba y este insert, el unique (plan_id, version)
  -- salta. El subbloque deshace también la copia a medias.
  begin
    select c.version, c.plan_version_id into v_nueva_version, v_nueva_id
      from viajes_planner.clonar_version_plan(p_plan_id) c;

    update viajes_planner.paradas pa
       set orden = x.n - 1, franja_id = x.franja_id
      from (
        select e ->> 'id' as id, e ->> 'franja_id' as franja_id, n
          from jsonb_array_elements(p_orden) with ordinality as t(e, n)
      ) x
     where pa.plan_version_id = v_nueva_id and pa.dia_index = p_dia_index and pa.id_externo = x.id;
  exception when unique_violation then
    raise exception 'version-desfasada';
  end;

  return query select v_nueva_version, v_nueva_id;
end;
$$;

revoke execute on function viajes_planner.reordenar_dia_plan(text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function viajes_planner.reordenar_dia_plan(text, integer, integer, jsonb) to service_role;
