-- Bloque arreglo-un-toque: llevar una parada a otro día del viaje como una
-- versión nueva. Aditiva: solo crea la función, que únicamente ejecuta
-- service_role (la ruta comprueba antes que el plan es del usuario).
set search_path = viajes_planner, public, extensions;

create or replace function mover_parada_a_dia(
  p_plan_id text,
  p_version_base integer,
  p_dia_origen integer,
  p_parada_id text,
  p_dia_destino integer,
  p_franja_id text,
  -- Posición (0 = la primera) que debe ocupar en el día de destino. Sin ella
  -- va al final de su franja; Deshacer la usa para devolverla a su sitio.
  p_posicion integer default null
)
returns table (version integer, plan_version_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_origen viajes_planner.plan_versiones%rowtype;
  v_franjas text[];
  v_fila viajes_planner.paradas%rowtype;
  v_nueva_version integer;
  v_nueva_id uuid;
  v_n integer;
begin
  -- Mismo bloqueo que reordenar_dia_plan: serializa dos cambios del mismo plan.
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

  if p_dia_origen is null or p_dia_destino is null or p_dia_origen = p_dia_destino
     or p_dia_origen < 0 or p_dia_destino < 0
     or p_dia_origen >= jsonb_array_length(v_origen.dias)
     or p_dia_destino >= jsonb_array_length(v_origen.dias)
     or p_parada_id is null or p_franja_id is null
     or (p_posicion is not null and p_posicion < 0) then
    raise exception 'orden-invalido';
  end if;

  select coalesce(array_agg(f ->> 'id' order by n), '{}') into v_franjas
    from jsonb_array_elements(v_origen.dias -> p_dia_destino -> 'franjas') with ordinality as t(f, n);
  if not (p_franja_id = any (v_franjas)) then
    raise exception 'orden-invalido';
  end if;

  select * into v_fila
    from viajes_planner.paradas pa
   where pa.plan_version_id = v_origen.id and pa.id_externo = p_parada_id and pa.dia_index = p_dia_origen;
  if not found then
    raise exception 'orden-invalido';
  end if;

  -- Un clon del trabajador no bloquea el plan: si confirma la versión N+1 antes
  -- de este insert, el unique (plan_id, version) salta y se traduce.
  begin
    select c.version, c.plan_version_id into v_nueva_version, v_nueva_id
      from viajes_planner.clonar_version_plan(p_plan_id) c;

    update viajes_planner.paradas pa
       set dia_index = p_dia_destino, franja_id = p_franja_id
     where pa.plan_version_id = v_nueva_id and pa.id_externo = p_parada_id;

    -- Día de origen: se cierra el hueco sin cambiar el orden relativo.
    update viajes_planner.paradas pa
       set orden = x.n - 1
      from (
        select p2.id, row_number() over (order by p2.orden, p2.id_externo) as n
          from viajes_planner.paradas p2
         where p2.plan_version_id = v_nueva_id and p2.dia_index = p_dia_origen
      ) x
     where pa.id = x.id;

    -- Día de destino: la parada entra con una clave fraccionaria entre dos
    -- vecinas y se renumera todo el día de una vez.
    select count(*) into v_n
      from viajes_planner.paradas p2
     where p2.plan_version_id = v_nueva_id and p2.dia_index = p_dia_destino and p2.id_externo <> p_parada_id;

    update viajes_planner.paradas pa
       set orden = x.n - 1
      from (
        select k.id, row_number() over (order by k.clave, k.id_externo) as n
          from (
            select p2.id, p2.id_externo,
                   case
                     when p2.id_externo = p_parada_id then
                       case
                         when p_posicion is not null then least(p_posicion, v_n) - 0.5
                         else (
                           select count(*) from viajes_planner.paradas p3
                            where p3.plan_version_id = v_nueva_id and p3.dia_index = p_dia_destino
                              and p3.id_externo <> p_parada_id
                              and coalesce(array_position(v_franjas, p3.franja_id), 0) <= array_position(v_franjas, p_franja_id)
                         ) - 0.5
                       end
                     else (
                       select count(*) from viajes_planner.paradas p3
                        where p3.plan_version_id = v_nueva_id and p3.dia_index = p_dia_destino
                          and p3.id_externo <> p_parada_id
                          and (p3.orden, p3.id_externo) < (p2.orden, p2.id_externo)
                     )
                   end as clave
              from viajes_planner.paradas p2
             where p2.plan_version_id = v_nueva_id and p2.dia_index = p_dia_destino
          ) k
      ) x
     where pa.id = x.id;
  exception when unique_violation then
    raise exception 'version-desfasada';
  end;

  return query select v_nueva_version, v_nueva_id;
end;
$$;

revoke execute on function viajes_planner.mover_parada_a_dia(text, integer, integer, text, integer, text, integer) from public, anon, authenticated;
grant execute on function viajes_planner.mover_parada_a_dia(text, integer, integer, text, integer, text, integer) to service_role;
