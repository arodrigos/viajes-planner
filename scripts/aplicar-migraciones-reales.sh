#!/usr/bin/env bash
# Issue #181 (claude-fleet-infra): aplica contra el proyecto Supabase real
# las migraciones de supabase/migrations/ que no estén ya en su historial.
#
# Caso real que lo motiva: el pipeline horizontal mergeó 3 migraciones a
# `main` (run a89b) que el gatekeeper aprobó, y ninguna llegó nunca al
# proyecto real -- ningún paso del pipeline tiene el MCP de Supabase para
# aplicarlas. Rompió "Mis viajes" en producción.
#
# Compara por NOMBRE, no por versión: el historial de migraciones de este
# proyecto es único POR PROYECTO (no por esquema) y lo comparte con otros
# productos de la flota, y las 9 migraciones de viajes-planner ya aplicadas
# a mano con `apply_migration` del MCP llevan una versión (timestamp de
# aplicación) que no coincide con el prefijo numérico del fichero local. Por
# eso no se usa `supabase db push`: compara por versión y fallaría en seco
# contra este historial compartido antes de aplicar nada.
#
# Se niega a aplicar cualquier migración con DDL no aditivo (DROP, TRUNCATE,
# renombrados, cambios de tipo, DELETE sin WHERE, índices/VACUUM/ALTER
# SYSTEM incompatibles con aplicarse en una sola petición transaccional) --
# esas requieren aplicación manual fuera de este job, con el mismo cuidado
# que cualquier cambio de esquema con datos reales (documentar el esquema
# antes, confirmación explícita). Si una sola migración pendiente no pasa el
# filtro, el job falla SIN aplicar ninguna de las pendientes -- una
# migración insegura bloquea toda la tanda, no se salta en silencio.
set -euo pipefail

: "${SUPABASE_PROJECT_REF:?falta SUPABASE_PROJECT_REF}"
: "${SUPABASE_ACCESS_TOKEN:?falta SUPABASE_ACCESS_TOKEN}"

API="https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/migrations"
AUTH=(-H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}")

# Patrones de DDL no aditivo, calibrados contra las 9 migraciones reales del
# repo para no rechazar lo que sí hay que dejar pasar: NUNCA "alter table" a
# secas (rechazaría los `enable row level security` y todos los `add
# column`) ni "delete" a secas (rechazaría `on delete cascade` y
# `grant ... delete on ...`). Los aflojamientos (`drop default`,
# `drop not null`) tampoco están aquí a propósito: no destruyen nada.
PATRON_NO_ADITIVO='(\bdrop[[:space:]]+(table|column|schema|view|function|policy|trigger|index|type|sequence|database|constraint)\b|\btruncate\b|\balter[[:space:]]+table\b.*\brename\b|\balter[[:space:]]+column\b.*\btype\b|\bdelete[[:space:]]+from\b|\bcreate[[:space:]]+(unique[[:space:]]+)?index[[:space:]]+concurrently\b|\bdrop[[:space:]]+index[[:space:]]+concurrently\b|\breindex\b.*\bconcurrently\b|\bvacuum\b|\balter[[:space:]]+system\b|\bcluster\b)'

nombre_de() {
  basename "$1" | sed -E 's/^[0-9]+_(.+)\.sql$/\1/'
}

echo "Consultando el historial real de migraciones del proyecto ${SUPABASE_PROJECT_REF}..."
aplicadas_json=$(curl -sS -f "${AUTH[@]}" "$API")
mapfile -t aplicadas < <(echo "$aplicadas_json" | jq -r '.[].name')

pendientes=()
for fichero in supabase/migrations/*.sql; do
  nombre=$(nombre_de "$fichero")
  ya_aplicada=0
  for a in "${aplicadas[@]+"${aplicadas[@]}"}"; do
    [ "$a" = "$nombre" ] && ya_aplicada=1 && break
  done
  [ "$ya_aplicada" -eq 0 ] && pendientes+=("$fichero")
done

if [ "${#pendientes[@]}" -eq 0 ]; then
  echo "Nada pendiente -- el historial real ya tiene todas las migraciones locales."
  exit 0
fi

echo "Pendientes de aplicar: ${pendientes[*]}"

rechazadas=0
for fichero in "${pendientes[@]}"; do
  if grep -iqE "$PATRON_NO_ADITIVO" "$fichero"; then
    echo "RECHAZADA (DDL no aditivo, requiere aplicación manual fuera de este job): $fichero"
    grep -inE "$PATRON_NO_ADITIVO" "$fichero" || true
    rechazadas=1
  fi
done
if [ "$rechazadas" -eq 1 ]; then
  echo ""
  echo "Al menos una migración pendiente no es puramente aditiva -- no se aplica NINGUNA de esta tanda."
  echo "Aplícala a mano, con el mismo protocolo de cualquier cambio de esquema con datos reales."
  exit 1
fi

for fichero in "${pendientes[@]}"; do
  nombre=$(nombre_de "$fichero")
  echo "Aplicando $fichero como '$nombre'..."
  cuerpo=$(jq -n --arg query "$(cat "$fichero")" --arg name "$nombre" '{query: $query, name: $name}')
  if ! respuesta=$(curl -sS -f "${AUTH[@]}" -H "Content-Type: application/json" -X POST "$API" -d "$cuerpo"); then
    echo "FALLO aplicando $fichero -- las migraciones pendientes posteriores NO se intentan."
    exit 1
  fi
  echo "OK: $respuesta"
done

echo "Todas las migraciones pendientes se aplicaron correctamente."
