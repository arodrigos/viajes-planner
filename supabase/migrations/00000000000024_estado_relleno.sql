-- salud-recuento-sql: /api/salud pasa de 26 consultas de recuento (y de
-- leer todas las versiones de plan para contar curiosidades antiguas) a una
-- sola llamada. Aditiva: solo una función nueva, sin tocar tablas.
set search_path = viajes_planner, public, extensions;

-- Security invoker: la ejecuta service_role y le basta con su DML sobre las
-- tablas; no hace falta elevar privilegios para contar. El search_path vacío
-- obliga a calificar cada objeto y evita que otro esquema lo secuestre.
-- El formato vigente de las curiosidades lo pasa el llamador (vive en
-- TypeScript, en FORMATO_CURIOSIDADES) para no tener dos fuentes de verdad
-- que se desincronicen cuando suba.
create or replace function viajes_planner.estado_relleno(p_formato_curiosidades integer default 5)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with ultima as (
    -- Solo la última versión de cada plan: es la única que rehace el trabajador.
    select distinct on (plan_id) id
    from viajes_planner.plan_versiones
    order by plan_id, version desc
  ),
  antiguas as (
    select c.curiosidades
    from viajes_planner.paradas c
    join ultima u on u.id = c.plan_version_id
    union all
    select a.curiosidades
    from viajes_planner.paradas_alternativas a
    join viajes_planner.paradas p on p.id = a.parada_id
    join ultima u on u.id = p.plan_version_id
  )
  select jsonb_build_object(
    'paradas_total', (select count(*) from viajes_planner.paradas),
    'paradas_resueltas', (select count(*) from viajes_planner.paradas where resolucion ->> 'estado' = 'resuelta'),
    'paradas_no_resueltas', (select count(*) from viajes_planner.paradas where resolucion ->> 'estado' = 'no-resuelta'),
    'paradas_en_error', (select count(*) from viajes_planner.paradas where resolucion ->> 'estado' = 'error'),
    'paradas_sin_intentar', (select count(*) from viajes_planner.paradas where resolucion is null),
    'paradas_con_foto', (select count(*) from viajes_planner.paradas where foto is not null),
    'paradas_con_alternativas', (
      select count(*) from viajes_planner.paradas p
      where exists (select 1 from viajes_planner.paradas_alternativas a where a.parada_id = p.id)
    ),
    'paradas_con_categoria', (select count(*) from viajes_planner.paradas where categoria is not null),
    'paradas_con_guia', (select count(*) from viajes_planner.paradas where guia is not null),
    'paradas_con_motivo', (select count(*) from viajes_planner.paradas where motivo is not null and motivo <> ''),
    -- case anidado: el orden de evaluación de un and no está garantizado y
    -- jsonb_array_length falla con algo que no sea un array. «is distinct
    -- from» porque con null (sin curiosidades, sin items) un «<>» no
    -- descartaría la fila y acabaría contada como antigua.
    'curiosidades_formato_antiguo', (
      select count(*) from antiguas
      where case
        when jsonb_typeof(curiosidades) is distinct from 'object' then false
        when jsonb_typeof(curiosidades -> 'items') is distinct from 'array' then false
        when jsonb_array_length(curiosidades -> 'items') = 0 then false
        else (case when jsonb_typeof(curiosidades -> 'formato') = 'number'
                   then (curiosidades ->> 'formato')::numeric else 0 end) < p_formato_curiosidades
      end
    ),
    'versiones_con_eventos', (select count(*) from viajes_planner.plan_versiones where eventos_intentados_en is not null),
    'versiones_multiciudad', (
      select count(*) from viajes_planner.plan_versiones where etapas is not null and etapas <> '[]'::jsonb
    ),
    'trabajos_inviables', (select count(*) from viajes_planner.trabajos where inviable is not null),
    'planes_total', (select count(*) from viajes_planner.planes),
    'planes_sin_version', (
      select count(*) from viajes_planner.planes p
      where not exists (select 1 from viajes_planner.plan_versiones v where v.plan_id = p.id)
    ),
    'planes_sin_trabajo_vivo', (
      select count(*) from viajes_planner.planes p
      where not exists (
        select 1 from viajes_planner.trabajos t where t.plan_id = p.id and t.eliminado_en is null
      )
    ),
    'planes_con_ciudad', (select count(*) from viajes_planner.planes where ciudad ->> 'estado' = 'resuelta'),
    'planes_sin_ciudad_identificable', (
      select count(*) from viajes_planner.planes where ciudad ->> 'estado' = 'sin-ciudad-identificable'
    ),
    'planes_sellados_pocas_paradas', (select count(*) from viajes_planner.planes where ciudad ->> 'categoria_motivo' = 'pocas-paradas'),
    'planes_sellados_sin_caja', (select count(*) from viajes_planner.planes where ciudad ->> 'categoria_motivo' = 'sin-caja'),
    'planes_sellados_zona_grande', (select count(*) from viajes_planner.planes where ciudad ->> 'categoria_motivo' = 'zona-grande'),
    'planes_sellados_sin_contencion', (select count(*) from viajes_planner.planes where ciudad ->> 'categoria_motivo' = 'sin-contencion'),
    'planes_sellados_sin_ventaja', (select count(*) from viajes_planner.planes where ciudad ->> 'categoria_motivo' = 'sin-ventaja'),
    'planes_sellados_sin_candidato_claro', (select count(*) from viajes_planner.planes where ciudad ->> 'categoria_motivo' = 'sin-candidato-claro'),
    'planes_sellados_ciudad_no_encontrada', (select count(*) from viajes_planner.planes where ciudad ->> 'categoria_motivo' = 'ciudad-no-encontrada')
  );
$$;

-- En un esquema propio service_role no hereda EXECUTE, y anon/authenticated
-- no deben poder leer recuentos de toda la base por PostgREST.
revoke execute on function viajes_planner.estado_relleno(integer) from public, anon, authenticated;
grant execute on function viajes_planner.estado_relleno(integer) to service_role;
