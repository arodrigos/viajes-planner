#!/usr/bin/env bash
# grt-ac4: oráculo de solo lectura sobre el proyecto real. Tras aplicar las
# migraciones, comprueba por la Management API (POST database/query, solo
# SELECT) que anon y authenticated no tienen privilegios en viajes_planner:
# tablas y columnas, secuencias, EXECUTE de PUBLIC/anon/authenticated en
# rutinas, y los privilegios por defecto (del esquema y los globales de los
# dueños de objetos del esquema, tipos r y S).
#
# Salida: 0 limpio (última línea «OK: …»), 1 si queda un privilegio sobre un
# objeto, 2 si queda uno por defecto, 64 si se pide --detalle en CI.
# En CI (GITHUB_ACTIONS o CI definidas) imprime solo recuentos por tipo: el
# log de un repo público no puede decir qué objeto, rol ni privilegio queda
# abierto. --detalle (solo en local) los lista.
set -euo pipefail

: "${SUPABASE_PROJECT_REF:?falta SUPABASE_PROJECT_REF}"
: "${SUPABASE_ACCESS_TOKEN:?falta SUPABASE_ACCESS_TOKEN}"

DETALLE=0
[ "${1:-}" = "--detalle" ] && DETALLE=1
EN_CI=0
{ [ -n "${GITHUB_ACTIONS:-}" ] || [ -n "${CI:-}" ]; } && EN_CI=1
if [ "$DETALLE" -eq 1 ] && [ "$EN_CI" -eq 1 ]; then
  echo "--detalle no se permite en CI: el log es público." >&2
  exit 64
fi

# La base de la API es sobrescribible solo para el doble de los tests.
API="${API_SUPABASE:-https://api.supabase.com}/v1/projects/${SUPABASE_PROJECT_REF}/database/query"
ESQ="viajes_planner"

consultar() {
  local cuerpo
  cuerpo=$(python3 -I -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$1")
  case "$1" in select*) ;; *) echo "solo se admiten consultas select" >&2; exit 70 ;; esac
  curl -sS -f -X POST "$API" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" -d "$cuerpo"
}

REL="c.relnamespace = '$ESQ'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')"
ROLES="(values ('anon'), ('authenticated')) r(rol)"
GLOBAL_DUENOS="d.defaclnamespace = 0 and d.defaclobjtype in ('r', 'S') and d.defaclrole in (select relowner from pg_class where relnamespace = '$ESQ'::regnamespace union select proowner from pg_proc where pronamespace = '$ESQ'::regnamespace)"
SQL_RECUENTOS="select
 (select count(*) from pg_class c cross join $ROLES cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv) where $REL and has_table_privilege(r.rol, c.oid, p.priv)) as tabla,
 (select count(*) from pg_class c cross join $ROLES cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(priv) where $REL and has_any_column_privilege(r.rol, c.oid, p.priv)) as columna,
 (select count(*) from pg_class c cross join $ROLES cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) p(priv) where c.relnamespace = '$ESQ'::regnamespace and c.relkind = 'S' and has_sequence_privilege(r.rol, c.oid, p.priv)) as secuencia,
 (select count(*) from pg_proc f cross join aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a where f.pronamespace = '$ESQ'::regnamespace and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole)) and a.privilege_type = 'EXECUTE') as rutina,
 (select count(*) from pg_default_acl d cross join aclexplode(d.defaclacl) a where d.defaclnamespace = '$ESQ'::regnamespace and a.grantee in ('anon'::regrole, 'authenticated'::regrole)) as def_esquema,
 (select count(*) from pg_default_acl d cross join aclexplode(d.defaclacl) a where $GLOBAL_DUENOS and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)) as def_global,
 (select count(*) from pg_class c where $REL) as n_rel,
 (select count(*) from pg_class c where c.relnamespace = '$ESQ'::regnamespace and c.relkind = 'S') as n_seq,
 (select count(*) from pg_proc f where f.pronamespace = '$ESQ'::regnamespace) as n_fun"

respuesta=$(consultar "$SQL_RECUENTOS")
campo() {
  python3 -I -c 'import json,sys; d=json.loads(sys.argv[1]); print(int(d[0][sys.argv[2]]))' "$respuesta" "$1"
}
tabla=$(campo tabla); columna=$(campo columna); secuencia=$(campo secuencia); rutina=$(campo rutina)
def_esquema=$(campo def_esquema); def_global=$(campo def_global)
n_rel=$(campo n_rel); n_seq=$(campo n_seq); n_fun=$(campo n_fun)

salida=0
[ "$tabla" -gt 0 ] && { echo "FALLO: $tabla privilegio(s) de relación (tabla) para roles de la Data API"; salida=1; }
[ "$columna" -gt 0 ] && { echo "FALLO: $columna privilegio(s) de relación (columna) para roles de la Data API"; salida=1; }
[ "$secuencia" -gt 0 ] && { echo "FALLO: $secuencia privilegio(s) de secuencia para roles de la Data API"; salida=1; }
[ "$rutina" -gt 0 ] && { echo "FALLO: $rutina privilegio(s) de rutina (EXECUTE) para PUBLIC o roles de la Data API"; salida=1; }
if [ "$salida" -eq 0 ]; then
  [ "$def_esquema" -gt 0 ] && { echo "FALLO: $def_esquema privilegio(s) por defecto (esquema)"; salida=2; }
  [ "$def_global" -gt 0 ] && { echo "FALLO: $def_global privilegio(s) por defecto (global)"; salida=2; }
fi

if [ "$salida" -ne 0 ]; then
  if [ "$DETALLE" -eq 1 ]; then
    consultar "select c.relname, r.rol, p.priv from pg_class c cross join $ROLES cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv) where $REL and has_table_privilege(r.rol, c.oid, p.priv)"
    echo
  fi
  exit "$salida"
fi
echo "OK: anon y authenticated sin privilegios en $ESQ ($n_rel relaciones, $n_seq secuencias, $n_fun rutinas)"
