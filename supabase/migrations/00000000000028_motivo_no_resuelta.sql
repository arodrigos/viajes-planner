-- Motivo de las paradas no resueltas en /api/salud. Función NUEVA al lado de
-- estado_relleno(integer), que no se toca: la web que ya está desplegada
-- valida esa salida con su lista exacta de claves y no debe notar nada.
-- Aditiva: no toca tablas ni otras funciones.
set search_path = viajes_planner, public, extensions;

-- Mismo patrón que estado_relleno: sql, stable, security invoker (le basta
-- el DML de service_role para contar) y search_path vacío, que obliga a
-- calificar cada objeto. Solo enteros agregados: el endpoint es público.
create or replace function viajes_planner.estado_relleno_motivos()
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
  )
  select jsonb_build_object(
    -- Desglose de las no-resueltas por resolucion.categoria_motivo (lista
    -- cerrada que escribe el resolutor). Sin la clave, o con un valor fuera
    -- de la lista, cuenta como desconocido: así las cinco suman siempre
    -- paradas_no_resueltas.
    'paradas_no_resueltas_sin_candidatos', (
      select count(*) from viajes_planner.paradas
      where resolucion ->> 'estado' = 'no-resuelta' and resolucion ->> 'categoria_motivo' = 'sin-candidatos'
    ),
    'paradas_no_resueltas_fuera_de_caja', (
      select count(*) from viajes_planner.paradas
      where resolucion ->> 'estado' = 'no-resuelta' and resolucion ->> 'categoria_motivo' = 'fuera-de-caja'
    ),
    'paradas_no_resueltas_nombre_distinto', (
      select count(*) from viajes_planner.paradas
      where resolucion ->> 'estado' = 'no-resuelta' and resolucion ->> 'categoria_motivo' = 'nombre-distinto'
    ),
    'paradas_no_resueltas_tipo_incompatible', (
      select count(*) from viajes_planner.paradas
      where resolucion ->> 'estado' = 'no-resuelta' and resolucion ->> 'categoria_motivo' = 'tipo-incompatible'
    ),
    'paradas_no_resueltas_motivo_desconocido', (
      select count(*) from viajes_planner.paradas
      where resolucion ->> 'estado' = 'no-resuelta'
        and (resolucion ->> 'categoria_motivo') is distinct from 'sin-candidatos'
        and (resolucion ->> 'categoria_motivo') is distinct from 'fuera-de-caja'
        and (resolucion ->> 'categoria_motivo') is distinct from 'nombre-distinto'
        and (resolucion ->> 'categoria_motivo') is distinct from 'tipo-incompatible'
    ),
    -- Denominador para medir la resolución sobre nombres de sitio: fuera las
    -- no-resueltas cuyo nombre no casó con nada dentro de la caja.
    'paradas_con_toponimo', (
      select count(*) from viajes_planner.paradas
      where (
        resolucion ->> 'estado' = 'no-resuelta'
        and resolucion ->> 'categoria_motivo' in ('sin-candidatos', 'nombre-distinto')
      ) is not true
    ),
    -- Mismo alcance que el barrido: solo la última versión de cada plan.
    'paradas_sin_intentar_ultima_version', (
      select count(*) from viajes_planner.paradas c
      join ultima u on u.id = c.plan_version_id
      where c.resolucion is null
    )
  );
$$;

-- Los mismos permisos que estado_relleno: en un esquema propio service_role
-- no hereda EXECUTE, y anon/authenticated no deben leer recuentos de toda la
-- base por PostgREST.
revoke execute on function viajes_planner.estado_relleno_motivos() from public, anon, authenticated;
grant execute on function viajes_planner.estado_relleno_motivos() to service_role;
