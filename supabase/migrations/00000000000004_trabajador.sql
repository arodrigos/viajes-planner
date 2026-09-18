-- Bloque trabajador-vps1: solo un trabajador vivo a la vez (trabajador-ac4).
-- No usa pg_try_advisory_lock: supabase-js habla con Postgres a través de
-- PostgREST, sin conexión persistente por trabajador, y un lock consultivo
-- de sesión se soltaría solo en cuanto termina la petición HTTP que lo pidió.
-- El cerrojo es una fila con dueño y caducidad, igual que el arrendamiento
-- de trabajos, y la exclusión la da un único UPDATE ... WHERE atómico.
create table cerrojo_trabajador (
  id integer primary key default 1,
  tomado_por text,
  tomado_hasta timestamptz,
  constraint cerrojo_trabajador_fila_unica check (id = 1)
);
insert into cerrojo_trabajador (id) values (1);

alter table cerrojo_trabajador enable row level security;

-- El GRANT de la migración inicial ("grant select on all tables") solo
-- alcanzó a las tablas que existían entonces: una tabla nueva sin GRANT
-- propio hace que PostgREST responda 404 en vez de 200 con cero filas, y
-- el propio test de RLS (persistencia-ac2) distingue "denegado por RLS"
-- (200, []) de "no expuesta" (404) — sin este GRANT fallaría por la razón
-- equivocada. RLS, sin políticas para anon/authenticated, sigue siendo
-- quien deniega de verdad.
grant select on cerrojo_trabajador to anon, authenticated;

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
