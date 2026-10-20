-- Bloque sitio-propio-datos: el dueño añade a un día un sitio suyo, con una
-- nota opcional, que el trabajador resuelve después como cualquier otra parada.
-- 1) paradas.nota (texto libre, ≤200) y paradas.propia (la parada la puso el
--    usuario, no el modelo).
-- 2) clonar_version_plan copia las dos columnas nuevas. El cuerpo vive ahora en
--    una sobrecarga con un segundo parámetro (la parada que se deja fuera de la
--    copia) y la firma de siempre queda como envoltorio: quitar un sitio es
--    clonar sin él, y el filtro aditivo de las migraciones rechaza cualquier
--    sentencia de borrado, también la que solo toca filas de la copia.
-- 3) anadir, corregir y quitar_sitio_propio crean la versión siguiente en una
--    sola transacción (patrón de reordenar_dia_plan): ninguna escribe nunca
--    sobre una versión existente.
set search_path = viajes_planner, public, extensions;

alter table paradas
  add column nota text check (nota is null or char_length(nota) <= 200),
  add column propia boolean not null default false;

create or replace function clonar_version_plan(p_plan_id text, p_excluir_id_externo text)
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
     where p.plan_version_id = v_origen.id
       and (p_excluir_id_externo is null or p.id_externo <> p_excluir_id_externo);

  insert into viajes_planner.procedencias (id, fuente, url)
    select m.procedencia_nueva, pr.fuente, pr.url
      from mapa_paradas m
      join viajes_planner.procedencias pr on pr.id = m.procedencia_vieja;

  insert into viajes_planner.paradas
    (id, id_externo, plan_version_id, dia_index, franja_id, nombre, lat, lon, duracion_min, prioridad, procedencia_id,
     descripcion, categoria, lugar, foto, resolucion, foto_intentada_en, alternativas_intentadas_en, motivo, coste,
     guia, curiosidades, guia_intentada_en, guia_formato, orden, nota, propia)
    select m.id_nuevo, p.id_externo, v_nueva_id, p.dia_index, p.franja_id, p.nombre, p.lat, p.lon, p.duracion_min, p.prioridad,
           m.procedencia_nueva, p.descripcion, p.categoria, p.lugar, p.foto, p.resolucion, p.foto_intentada_en,
           p.alternativas_intentadas_en, p.motivo, p.coste, p.guia, p.curiosidades, p.guia_intentada_en, p.guia_formato, p.orden,
           p.nota, p.propia
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

create or replace function clonar_version_plan(p_plan_id text)
returns table (version integer, plan_version_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query select c.version, c.plan_version_id from viajes_planner.clonar_version_plan(p_plan_id, null) c;
end;
$$;

revoke execute on function viajes_planner.clonar_version_plan(text, text) from public, anon, authenticated;
grant execute on function viajes_planner.clonar_version_plan(text, text) to service_role;
revoke execute on function viajes_planner.clonar_version_plan(text) from public, anon, authenticated;
grant execute on function viajes_planner.clonar_version_plan(text) to service_role;

create function anadir_sitio_propio(p_plan_id text, p_version_base integer, p_dia_index integer, p_nombre text, p_nota text)
returns table (version integer, plan_version_id uuid, id_externo text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_origen viajes_planner.plan_versiones%rowtype;
  v_franja text;
  v_nueva_version integer;
  v_nueva_id uuid;
  v_nuevo_id_externo text;
  v_procedencia_id uuid := gen_random_uuid();
  v_orden integer;
begin
  -- El bloqueo serializa dos altas del mismo plan; frente a una sustitución,
  -- que clona sin bloquear, cierra la carrera unique (plan_id, version).
  perform 1 from viajes_planner.planes pl where pl.id = p_plan_id for update;
  if not found then
    raise exception 'version-desfasada';
  end if;

  select * into v_origen
    from viajes_planner.plan_versiones pv
   where pv.plan_id = p_plan_id
   order by pv.version desc
   limit 1;
  if not found or v_origen.version <> p_version_base then
    raise exception 'version-desfasada';
  end if;

  if p_dia_index is null or p_dia_index < 0 or p_dia_index >= jsonb_array_length(v_origen.dias) then
    raise exception 'dia-invalido';
  end if;
  select f ->> 'id' into v_franja
    from jsonb_array_elements(v_origen.dias -> p_dia_index -> 'franjas') with ordinality as t(f, n)
   order by n desc
   limit 1;
  if v_franja is null then
    raise exception 'dia-invalido';
  end if;

  if p_nombre is null or char_length(p_nombre) not between 2 and 80
     or (p_nota is not null and char_length(p_nota) > 200) then
    raise exception 'sitio-invalido';
  end if;

  if (select count(*) from viajes_planner.paradas pa
       where pa.plan_version_id = v_origen.id and pa.propia and pa.resolucion is null) >= 20 then
    raise exception 'demasiados-pendientes';
  end if;

  select c.version, c.plan_version_id into v_nueva_version, v_nueva_id
    from viajes_planner.clonar_version_plan(p_plan_id) c;

  -- Las paradas sin orden explícito se leen detrás de las que lo tienen: para
  -- que el sitio nuevo quede el último de su franja, las de esa franja sin
  -- orden pasan antes a tenerlo, en el mismo orden en que ya se leían.
  select coalesce(max(pa.orden), -1) into v_orden
    from viajes_planner.paradas pa
   where pa.plan_version_id = v_nueva_id and pa.dia_index = p_dia_index;
  update viajes_planner.paradas pa
     set orden = v_orden + x.n
    from (
      select s.id, row_number() over (order by s.id_externo) as n
        from viajes_planner.paradas s
       where s.plan_version_id = v_nueva_id and s.dia_index = p_dia_index and s.franja_id = v_franja and s.orden is null
    ) x
   where pa.id = x.id;
  select coalesce(max(pa.orden), -1) + 1 into v_orden
    from viajes_planner.paradas pa
   where pa.plan_version_id = v_nueva_id and pa.dia_index = p_dia_index;

  loop
    v_nuevo_id_externo := 'propia-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    exit when not exists (
      select 1 from viajes_planner.paradas pa where pa.plan_version_id = v_nueva_id and pa.id_externo = v_nuevo_id_externo
    );
  end loop;

  insert into viajes_planner.procedencias (id, fuente) values (v_procedencia_id, 'propuesto-sin-verificar');
  insert into viajes_planner.paradas
    (id, id_externo, plan_version_id, dia_index, franja_id, nombre, lat, lon, duracion_min, prioridad, procedencia_id,
     descripcion, categoria, resolucion, orden, nota, propia)
  values
    (gen_random_uuid(), v_nuevo_id_externo, v_nueva_id, p_dia_index, v_franja, p_nombre, null, null, 60, 50, v_procedencia_id,
     '', null, null, v_orden, p_nota, true);

  return query select v_nueva_version, v_nueva_id, v_nuevo_id_externo;
end;
$$;

create function corregir_sitio_propio(p_plan_id text, p_version_base integer, p_id_externo text, p_nombre text)
returns table (version integer, plan_version_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_origen viajes_planner.plan_versiones%rowtype;
  v_vieja viajes_planner.paradas%rowtype;
  v_nueva_version integer;
  v_nueva_id uuid;
  v_procedencia_id uuid := gen_random_uuid();
begin
  perform 1 from viajes_planner.planes pl where pl.id = p_plan_id for update;
  if not found then
    raise exception 'version-desfasada';
  end if;

  select * into v_origen
    from viajes_planner.plan_versiones pv
   where pv.plan_id = p_plan_id
   order by pv.version desc
   limit 1;
  if not found or v_origen.version <> p_version_base then
    raise exception 'version-desfasada';
  end if;

  if p_nombre is null or char_length(p_nombre) not between 2 and 80 then
    raise exception 'sitio-invalido';
  end if;
  select * into v_vieja
    from viajes_planner.paradas pa
   where pa.plan_version_id = v_origen.id and pa.id_externo = p_id_externo and pa.propia;
  if not found then
    raise exception 'no-es-propia';
  end if;

  -- La copia nace sin el sitio y se le añade uno nuevo con el mismo id, hueco
  -- y nota: lo que se resolvió sobre el nombre viejo (ubicación, foto, guía y
  -- alternativas cercanas) no se arrastra.
  select c.version, c.plan_version_id into v_nueva_version, v_nueva_id
    from viajes_planner.clonar_version_plan(p_plan_id, p_id_externo) c;

  insert into viajes_planner.procedencias (id, fuente) values (v_procedencia_id, 'propuesto-sin-verificar');
  insert into viajes_planner.paradas
    (id, id_externo, plan_version_id, dia_index, franja_id, nombre, lat, lon, duracion_min, prioridad, procedencia_id,
     descripcion, categoria, resolucion, orden, nota, propia)
  values
    (gen_random_uuid(), v_vieja.id_externo, v_nueva_id, v_vieja.dia_index, v_vieja.franja_id, p_nombre, null, null,
     v_vieja.duracion_min, v_vieja.prioridad, v_procedencia_id, '', null, null, v_vieja.orden, v_vieja.nota, true);

  return query select v_nueva_version, v_nueva_id;
end;
$$;

create function quitar_sitio_propio(p_plan_id text, p_version_base integer, p_id_externo text)
returns table (version integer, plan_version_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_origen viajes_planner.plan_versiones%rowtype;
begin
  perform 1 from viajes_planner.planes pl where pl.id = p_plan_id for update;
  if not found then
    raise exception 'version-desfasada';
  end if;

  select * into v_origen
    from viajes_planner.plan_versiones pv
   where pv.plan_id = p_plan_id
   order by pv.version desc
   limit 1;
  if not found or v_origen.version <> p_version_base then
    raise exception 'version-desfasada';
  end if;

  if not exists (
    select 1 from viajes_planner.paradas pa
     where pa.plan_version_id = v_origen.id and pa.id_externo = p_id_externo and pa.propia
  ) then
    raise exception 'no-es-propia';
  end if;

  -- La copia nace sin ese sitio: la versión que se deja atrás no se toca.
  return query select c.version, c.plan_version_id from viajes_planner.clonar_version_plan(p_plan_id, p_id_externo) c;
end;
$$;

revoke execute on function viajes_planner.anadir_sitio_propio(text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function viajes_planner.anadir_sitio_propio(text, integer, integer, text, text) to service_role;
revoke execute on function viajes_planner.corregir_sitio_propio(text, integer, text, text) from public, anon, authenticated;
grant execute on function viajes_planner.corregir_sitio_propio(text, integer, text, text) to service_role;
revoke execute on function viajes_planner.quitar_sitio_propio(text, integer, text) from public, anon, authenticated;
grant execute on function viajes_planner.quitar_sitio_propio(text, integer, text) to service_role;
