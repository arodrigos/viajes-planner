#!/usr/bin/env bash
# viajes-ac2(b): GET /api/viajes contra un build de producción, sin sesión,
# responde 401 exacto y sin Set-Cookie.
#
# DESVIACIÓN DECLARADA (ver desviaciones en el entregable de desarrollo):
# este chequeo NO vive en verificar-esqueleto.sh pese a su estilo curl
# similar, porque ese script arranca el servidor A PROPÓSITO sin
# SUPABASE_URL/SUPABASE_ANON_KEY (esqueleto-ac1 depende de ese vacío para
# probar su propio camino de error) -contra ese servidor, requireSesion no
# respondería 401, lanzaría 500 al intentar construir el cliente de
# Supabase. Este script asume que YA existe una pila local de Supabase
# arrancada (supabase start) y sus credenciales en el entorno, igual que
# hace el resto del job "persistencia" del que forma parte.
set -euo pipefail

: "${SUPABASE_URL:?falta SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?falta SUPABASE_ANON_KEY}"
: "${SUPABASE_SERVICE_ROLE_KEY:?falta SUPABASE_SERVICE_ROLE_KEY}"
: "${SUPABASE_SCHEMA:?falta SUPABASE_SCHEMA}"

PORT="${PORT:-3200}"
VIAJES_URL="http://localhost:${PORT}"
export CORREOS_PERMITIDOS="${CORREOS_PERMITIDOS:-ci-test@example.com}"

npm run build

npm run start -- -p "$PORT" >/tmp/viajes-planner-start-viajes.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl -fsS "$VIAJES_URL/api/salud" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "== viajes-ac2(b): GET /api/viajes sin sesión responde 401 exacto y sin Set-Cookie =="
CABECERAS="$(mktemp)"
CODIGO="$(curl -sS -o /dev/null -D "$CABECERAS" -w '%{http_code}' "$VIAJES_URL/api/viajes")"
if [ "$CODIGO" != "401" ]; then
  echo "FALLO: se esperaba 401, se obtuvo $CODIGO" >&2
  exit 1
fi
if grep -qi '^set-cookie:' "$CABECERAS"; then
  echo "FALLO: la respuesta 401 trae Set-Cookie" >&2
  cat "$CABECERAS" >&2
  exit 1
fi

echo "OK: verificación de viajes completa"
