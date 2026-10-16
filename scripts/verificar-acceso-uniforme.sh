#!/usr/bin/env bash
# unif-ac5 (issue #39): comprobación ejecutable contra un build de
# producción, no solo contra el manejador en memoria -si alguien
# reintrodujera la ramificación 403/401, este smoke la detectaría igual que
# el test de integración. Es el smoke_test del manifiesto y SUSTITUYE al
# smoke anterior de esta misma ruta, que exigía un 403.
#
# CORREO_DE_PRUEBA tiene que ser una dirección YA presente en
# CORREOS_PERMITIDOS -nunca se escribe aquí ni en el repositorio-. Contra el
# despliegue real la pone el dueño del producto; en CI reutiliza ci-test@example.com, que
# ya está en la lista de prueba del job.
#
# No envía cabecera de bypass: contra un despliegue con protección delante
# de la app falla en vez de dar OK, porque exige el 401 y el cuerpo exactos
# de la ruta.
set -euo pipefail

: "${VIAJES_URL:=}"
: "${CORREO_DE_PRUEBA:?falta CORREO_DE_PRUEBA (un correo de CORREOS_PERMITIDOS)}"

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [ -z "$VIAJES_URL" ]; then
  # Sin URL de despliegue: arranca un build de producción en local, mismo
  # commit real del repositorio, igual que hacen verificar-esqueleto.sh y
  # verificar-viajes.sh.
  PORT="${PORT:-3300}"
  VIAJES_URL="http://localhost:${PORT}"
  export CORREOS_PERMITIDOS="${CORREOS_PERMITIDOS:-$CORREO_DE_PRUEBA}"

  npm run build

  npm run start -- -p "$PORT" >/tmp/viajes-planner-start-acceso-uniforme.log 2>&1 &
  SERVER_PID=$!

  for _ in $(seq 1 30); do
    if curl -fsS "$VIAJES_URL/api/salud" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

echo "== unif-ac5: verificar-codigo responde igual para un correo autorizado y uno no autorizado =="

CORREO_AJENO="correo-ajeno-smoke-$RANDOM$RANDOM@ej.com"
CODIGO_INVENTADO="000000"

pedir() {
  local correo="$1"
  local cuerpo_archivo="$2"
  local cabeceras_archivo="$3"
  curl -sS -o "$cuerpo_archivo" -D "$cabeceras_archivo" -w '%{http_code}' \
    -X POST "$VIAJES_URL/api/acceso/verificar-codigo" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"${correo}\",\"codigo\":\"${CODIGO_INVENTADO}\"}"
}

CUERPO_AUTORIZADO="$(mktemp)"
CABECERAS_AUTORIZADO="$(mktemp)"
CODIGO_HTTP_AUTORIZADO="$(pedir "$CORREO_DE_PRUEBA" "$CUERPO_AUTORIZADO" "$CABECERAS_AUTORIZADO")"

CUERPO_AJENO="$(mktemp)"
CABECERAS_AJENO="$(mktemp)"
CODIGO_HTTP_AJENO="$(pedir "$CORREO_AJENO" "$CUERPO_AJENO" "$CABECERAS_AJENO")"

FALLO=0

if [ "$CODIGO_HTTP_AUTORIZADO" = "403" ] || [ "$CODIGO_HTTP_AJENO" = "403" ]; then
  echo "FALLO: alguna respuesta sigue siendo 403 (el arreglo del #39 no está aplicado)" >&2
  FALLO=1
fi

if [ "$CODIGO_HTTP_AUTORIZADO" != "$CODIGO_HTTP_AJENO" ]; then
  echo "FALLO: los estados difieren ($CODIGO_HTTP_AUTORIZADO vs $CODIGO_HTTP_AJENO)" >&2
  FALLO=1
fi

if ! cmp -s "$CUERPO_AUTORIZADO" "$CUERPO_AJENO"; then
  echo "FALLO: los cuerpos difieren" >&2
  echo "-- autorizado --" >&2; cat "$CUERPO_AUTORIZADO" >&2
  echo "-- ajeno --" >&2; cat "$CUERPO_AJENO" >&2
  FALLO=1
fi

if grep -qi '^set-cookie:' "$CABECERAS_AUTORIZADO" || grep -qi '^set-cookie:' "$CABECERAS_AJENO"; then
  echo "FALLO: alguna respuesta trae Set-Cookie" >&2
  FALLO=1
fi

# Que las dos respuestas coincidan no basta: un despliegue roto de forma
# uniforme (500 por configuración, 404 si la ruta desaparece, una capa de
# protección delante de la app) también responde igual a los dos correos.
# Basta con mirar un lado porque las comprobaciones de arriba ya exigen que
# los dos coincidan en estado y cuerpo.
CUERPO_ESPERADO='{"error":"código incorrecto o caducado"}'

if [ "$CODIGO_HTTP_AUTORIZADO" != "401" ]; then
  echo "FALLO: se esperaba 401 y llegó $CODIGO_HTTP_AUTORIZADO" >&2
  FALLO=1
fi

if [ "$(cat "$CUERPO_AUTORIZADO")" != "$CUERPO_ESPERADO" ]; then
  echo "FALLO: el cuerpo no es el de código incorrecto o caducado" >&2
  echo "-- recibido --" >&2; cat "$CUERPO_AUTORIZADO" >&2; echo >&2
  FALLO=1
fi

if [ "$FALLO" != "0" ]; then
  exit 1
fi

echo "OK: la respuesta de verificar-codigo es uniforme"
