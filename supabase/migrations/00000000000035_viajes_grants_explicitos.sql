-- Bloque grants-explicitos: el producto lee y escribe solo con service_role
-- (clienteServicio), así que anon y authenticated dejan de tener privilegios
-- sobre cualquier objeto del esquema. Hasta hoy la RLS los dejaba en "200 con
-- 0 filas"; sin privilegio, PostgREST responde permiso denegado y las
-- políticas ni se evalúan. Las políticas se quedan como están.
-- Idempotente: revoke y grant repetidos no cambian el estado.
set search_path = viajes_planner, public, extensions;

-- Tablas, vistas y demás relaciones. El revoke de tabla se lleva también los
-- privilegios de columna que hubiera (lugares_google daba SELECT de dos
-- columnas a authenticated). Incluye trabajos y miembros_plan.
revoke all on all tables in schema viajes_planner from anon, authenticated;
revoke all on all sequences in schema viajes_planner from anon, authenticated;

-- Funciones: el EXECUTE de PUBLIC sobre funciones nuevas es global y no se
-- puede quitar desde aquí; por eso cada migración que crea una función repite
-- su revoke. Esta lo deja limpio para las que ya existen.
revoke execute on all functions in schema viajes_planner from public, anon, authenticated;

-- service_role no hereda nada en un esquema propio: se le da objeto a objeto,
-- sin depender de privilegios por defecto del proyecto.
do $$
declare
  objeto record;
begin
  for objeto in
    select c.oid::regclass::text as nombre, c.relkind
    from pg_class c
    where c.relnamespace = 'viajes_planner'::regnamespace
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  loop
    if objeto.relkind = 'S' then
      execute format('grant usage, select on sequence %s to service_role', objeto.nombre);
    else
      execute format('grant select, insert, update, delete on table %s to service_role', objeto.nombre);
    end if;
  end loop;

  for objeto in
    select p.oid::regprocedure::text as nombre
    from pg_proc p
    where p.pronamespace = 'viajes_planner'::regnamespace
  loop
    execute format('grant execute on function %s to service_role', objeto.nombre);
  end loop;
end $$;

-- Privilegios por defecto del esquema que dan algo a anon o authenticated
-- (la 001 dejó SELECT en tablas). Solo se tocan las entradas de ESTE esquema,
-- para cada rol creador del que current_user es miembro; las globales
-- (defaclnamespace = 0) son de todo el proyecto y no se tocan. Si tras
-- limpiar queda alguna, la migración aborta entera.
do $$
declare
  entrada record;
  restantes integer;
begin
  for entrada in
    select distinct d.defaclrole::regrole::text as creador, d.defaclobjtype
    from pg_default_acl d
    where d.defaclnamespace = 'viajes_planner'::regnamespace
      and exists (
        select 1 from aclexplode(d.defaclacl) a
        where a.grantee in ('anon'::regrole, 'authenticated'::regrole)
      )
      and pg_has_role(current_user, d.defaclrole, 'member')
  loop
    execute format(
      'alter default privileges for role %s in schema viajes_planner revoke all on %s from anon, authenticated',
      entrada.creador,
      case entrada.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' else 'types' end
    );
  end loop;

  select count(*) into restantes
  from pg_default_acl d
  where d.defaclnamespace = 'viajes_planner'::regnamespace
    and exists (
      select 1 from aclexplode(d.defaclacl) a
      where a.grantee in ('anon'::regrole, 'authenticated'::regrole)
    );
  if restantes > 0 then
    raise exception 'quedan % privilegios por defecto para anon o authenticated en viajes_planner', restantes;
  end if;
end $$;
