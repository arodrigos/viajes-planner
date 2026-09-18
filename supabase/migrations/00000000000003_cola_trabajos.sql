-- Bloque cola-trabajos: los criterios del viaje viajan con el trabajo (el
-- trabajador los lee de aquí, no de otro sitio), y la toma de un trabajo es
-- atómica de verdad -no un candado de aplicación que dos procesos
-- distintos no podrían compartir-, usando FOR UPDATE SKIP LOCKED dentro de
-- una única función de Postgres.
alter table trabajos add column criterios jsonb;

create or replace function tomar_siguiente_trabajo(p_tomado_por text, p_arrendamiento_min integer)
returns setof trabajos
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from trabajos
  where estado in ('encolado', 'pausado-por-cuota')
    and (reintento_no_antes_de is null or reintento_no_antes_de <= now())
    and (tomado_hasta is null or tomado_hasta < now())
  order by prioridad desc, creado_en asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  return query
  update trabajos
  set estado = 'en-curso',
      tomado_por = p_tomado_por,
      tomado_hasta = now() + (p_arrendamiento_min || ' minutes')::interval,
      actualizado_en = now()
  where id = v_id
  returning *;
end;
$$;
