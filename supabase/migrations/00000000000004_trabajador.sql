-- Bloque trabajador-vps1: solo un trabajador vivo a la vez (trabajador-ac4).
-- No usa pg_try_advisory_lock: supabase-js habla con Postgres a través de
-- PostgREST, sin conexión persistente por trabajador, y un lock consultivo
-- de sesión se soltaría solo en cuanto termina la petición HTTP que lo pidió.
-- El cerrojo es una fila con dueño y caducidad, igual que el arrendamiento
-- de trabajos, y la exclusión la da un único UPDATE ... WHERE atómico.
set search_path = viajes_planner, public, extensions;

create table cerrojo_trabajador (
  id integer primary key default 1,
  tomado_por text,
  tomado_hasta timestamptz,
  constraint cerrojo_trabajador_fila_unica check (id = 1)
);
insert into cerrojo_trabajador (id) values (1);

alter table cerrojo_trabajador enable row level security;

-- `alter default privileges` de la migración inicial ya cubre esta tabla
-- nueva (select para anon/authenticated, DML para service_role) sin que
-- nadie tenga que acordarse; este GRANT explícito es redundante a
-- propósito, como red de seguridad: si alguna vez el default privilege no
-- se aplicara (por ejemplo, porque la migración corriera con otro rol),
-- esta línea evita que la tabla quede en 404 -"no expuesta"- en vez de 200
-- con cero filas -"denegada por RLS"-, que es la distinción real que hace
-- el test de esquema-ac4.
grant select on cerrojo_trabajador to anon, authenticated;
grant select, insert, update, delete on cerrojo_trabajador to service_role;

create or replace function adquirir_cerrojo_trabajador(p_tomado_por text, p_ttl_min integer)
returns boolean
language plpgsql
as $$
declare
  v_adquirido boolean;
begin
  update cerrojo_trabajador
  set tomado_por = p_tomado_por,
      tomado_hasta = now() + (p_ttl_min || ' minutes')::interval
  where id = 1
    and (tomado_hasta is null or tomado_hasta < now())
  returning true into v_adquirido;

  return coalesce(v_adquirido, false);
end;
$$;

create or replace function liberar_cerrojo_trabajador(p_tomado_por text)
returns void
language sql
as $$
  update cerrojo_trabajador
  set tomado_por = null, tomado_hasta = null
  where id = 1 and tomado_por = p_tomado_por;
$$;

revoke execute on function adquirir_cerrojo_trabajador(text, integer) from public;
revoke execute on function liberar_cerrojo_trabajador(text) from public;

-- Mismo motivo que en tomar_siguiente_trabajo (migración 3): en un esquema
-- propio service_role no hereda EXECUTE de fábrica, así que el revoke
-- anterior dejaría al trabajador sin poder tomar ni soltar el cerrojo.
grant execute on function adquirir_cerrojo_trabajador(text, integer) to service_role;
grant execute on function liberar_cerrojo_trabajador(text) to service_role;
