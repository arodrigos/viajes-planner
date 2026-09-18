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
# acceso-ac2: el prebuild exige la lista blanca configurada; en un build
# real de Vercel la pone Adrián, aquí basta un valor de prueba.
export CORREOS_PERMITIDOS="${CORREOS_PERMITIDOS:-ci-test@example.com}"

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

echo "== esqueleto-ac1: vercel.json declara el único cron diario del esqueleto, y /api/salud lo confirma =="
jq -e '.crons | length == 1 and .[0].path == "/api/salud" and (.[0].schedule | test("^[0-9]+ [0-9]+ \\* \\* \\*$"))' \
  vercel.json >/dev/null
jq -e '.crons_registrados == 1' /tmp/salud.json >/dev/null

# LIMITACIÓN DECLARADA (ver desviaciones en el entregable de desarrollo):
# este job arranca la app a propósito sin SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
# (más abajo, trabajador-vps1, depende de ese vacío para probar su propio
# camino de error) y sin un trabajador de VPS1 corriendo tick(). Por eso
# solo se comprueba que estos campos existen con el TIPO que el smoke_test
# del manifiesto espera, no los valores "sanos" (supabase: "activa",
# trabajador.visto_hace_seg < 300...): esos sí los comprueba de verdad
# el test de integración de route.ts contra Supabase local (npm run
# test:integration, job "persistencia"), y el smoke_test completo solo
# tiene sentido contra el despliegue real ya con VPS1 vivo.
echo "== esqueleto-ac1: /api/salud trae la forma completa que pide el smoke_test del manifiesto =="
jq -e '
  (.supabase == "error") and
  (.esquema_version == 1) and
  (.modelo_acceso == "suscripcion-vps1") and
  (.trabajador.visto_hace_seg == null) and
  (.secretos_faltantes | index("SUPABASE_URL") != null) and
  (.credenciales_modelo_en_web == false)
' /tmp/salud.json >/dev/null

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

echo "== trabajador-vps1: scripts/trabajador-tick.ts carga fuera de Next.js (--conditions=react-server) =="
# El script del cron de VPS1 corre con `tsx` puro, sin el bundler de
# Next.js: sin --conditions=react-server, cada módulo "server-only" que
# importa (clienteServicio, procesarTrabajo...) lanza al cargar. Aquí no
# hay SUPABASE_URL, así que el fallo esperado es ESE, no el de server-only.
SALIDA_TRABAJADOR="$(npm run --silent trabajador:tick 2>&1 || true)"
if echo "$SALIDA_TRABAJADOR" | grep -q "cannot be imported from a Client Component"; then
  echo "FALLO: scripts/trabajador-tick.ts no carga fuera de Next.js (falta --conditions=react-server)" >&2
  echo "$SALIDA_TRABAJADOR" >&2
  exit 1
fi
if ! echo "$SALIDA_TRABAJADOR" | grep -q "Faltan SUPABASE_URL"; then
  echo "FALLO: se esperaba el error de configuración de trabajador-tick.ts, salida distinta:" >&2
  echo "$SALIDA_TRABAJADOR" >&2
  exit 1
fi

echo "OK: verificación de esqueleto completa"
