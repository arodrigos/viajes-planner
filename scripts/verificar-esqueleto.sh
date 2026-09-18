#!/usr/bin/env bash
# Evidencia real de los criterios de aceptación del bloque "esqueleto":
# construye la app, la arranca como lo haría producción y comprueba
# /api/salud y el HTML servido, tal como pide el diseño (curl + jq).
#
# LIMITACIÓN DECLARADA (ver desviaciones en el entregable de desarrollo):
# $VIAJES_URL en el diseño apunta a la URL de producción en Vercel. Este
# repositorio no tiene conectado ningún proyecto de Vercel todavía -eso es
# un paso de traspaso posterior a la aprobación, según el propio manifiesto-
# así que aquí se verifica contra un build de producción servido en local,
# con el mismo commit real del repositorio.
set -euo pipefail

PORT="${PORT:-3100}"
export COMMIT_SHA
COMMIT_SHA="$(git rev-parse HEAD)"
VIAJES_URL="http://localhost:${PORT}"

npm run build

npm run start -- -p "$PORT" >/tmp/viajes-planner-start.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl -fsS "$VIAJES_URL/api/salud" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "== esqueleto-ac1: /api/salud responde e identifica el commit desplegado =="
curl -fsS "$VIAJES_URL/api/salud" | tee /tmp/salud.json | jq -e '.ok == true and (.commit | length) == 40'

echo "== esqueleto-ac3: el HTML servido no lleva afiliación ni publicidad =="
HTML="$(curl -fsS "$VIAJES_URL/")"
if echo "$HTML" | grep -qE '[?&](tag|aid|ref|affiliate|partner_?id)='; then
  echo "FALLO: parámetro de afiliación encontrado en el HTML servido" >&2
  exit 1
fi
for dominio in googlesyndication.com doubleclick.net "adsystem.amazon" taboola.com outbrain.com; do
  if echo "$HTML" | grep -qF "$dominio"; then
    echo "FALLO: dominio publicitario '$dominio' encontrado en el HTML servido" >&2
    exit 1
  fi
done

echo "OK: verificación de esqueleto completa"
