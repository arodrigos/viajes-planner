-- Bloque verificacion-en-preview (defectos de sustituir): dos cambios aditivos.
-- 1) La alternativa que nace de una parada sustituida guarda el motivo y el
--    coste que esa parada tenía en su hueco, para devolvérselos al deshacer.
--    `motivo` (NOT NULL) sigue siendo el texto de alternativa que ve el
--    usuario; estos dos campos son del hueco, no del sitio.
-- 2) clonar_version_plan copia la última versión de un plan dentro de la base.
--    Sustituir una parada reescribía el plan entero desde la función de
--    Vercel (54 paradas y 134 alternativas con guías y curiosidades, ida y
--    vuelta por PostgREST) y tardaba más de 5 s; copiar en SQL deja a la
--    función solo el retoque de la parada tocada.
set search_path = viajes_planner, public, extensions;

alter table paradas_alternativas
  add column motivo_parada text,
  add column coste_parada jsonb;

create function clonar_version_plan(p_plan_id text)
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
     guia, curiosidades, guia_intentada_en, guia_formato)
    select m.id_nuevo, p.id_externo, v_nueva_id, p.dia_index, p.franja_id, p.nombre, p.lat, p.lon, p.duracion_min, p.prioridad,
           m.procedencia_nueva, p.descripcion, p.categoria, p.lugar, p.foto, p.resolucion, p.foto_intentada_en,
           p.alternativas_intentadas_en, p.motivo, p.coste, p.guia, p.curiosidades, p.guia_intentada_en, p.guia_formato
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

revoke execute on function viajes_planner.clonar_version_plan(text) from public, anon, authenticated;
grant execute on function viajes_planner.clonar_version_plan(text) to service_role;
