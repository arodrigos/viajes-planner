#!/usr/bin/env bash
# rls-ac2: valida en cada PR, antes de mergear, que las migraciones de
# supabase/migrations/ pasan el filtro aditivo REAL del job
# `aplicar-migraciones` -- no una copia del patrón, que se desincronizaría
# en silencio, sino el mismo PATRON_NO_ADITIVO que ese job usa de verdad
# contra el proyecto Supabase real. Corre en `verificar-esqueleto`, que ya
# se dispara en cada PR y no necesita una pila de Supabase.
#
# DESVIACIÓN respecto al diseño: NO se comprueban las 9 migraciones de
# MIGRACIONES_PRE_AUTOMATIZACION. El diseño decía "lo pasa sobre
# supabase/migrations/*.sql" sin excepción, pero probado contra el repo
# real, la 00000000000005_esquema_fase1.sql (aplicada a mano vía MCP antes
# de que existiera el job aplicar-migraciones, issue #181) contiene
# `rename column` y `drop constraint` -- DDL no aditivo que el patrón real
# SÍ rechaza. Comprobar el histórico entero habría dejado este paso en rojo
# para siempre en cualquier PR, aunque ninguna migración nueva tuviera nada
# malo. El filtro real del job solo mira migraciones PENDIENTES (por
# nombre, contra el historial de Supabase); este script no tiene esa
# consulta a mano porque `verificar-esqueleto` no lleva credenciales de
# Supabase a propósito, así que aproxima "pendiente" con la frontera real:
# todo lo aplicado a mano antes de la 010 queda fuera, todo lo que exista a
# partir de la 010 pasa siempre por el job automático y sí se comprueba.
set -euo pipefail

FICHERO_FUENTE="scripts/aplicar-migraciones-reales.sh"
MIGRACIONES_PRE_AUTOMATIZACION=(
  "00000000000001_esquema_inicial.sql"
  "00000000000002_acceso.sql"
  "00000000000003_cola_trabajos.sql"
  "00000000000004_trabajador.sql"
  "00000000000005_esquema_fase1.sql"
  "00000000000006_avisos_plan.sql"
  "00000000000007_mis_viajes.sql"
  "00000000000008_eliminar_planificaciones.sql"
  "00000000000009_recomendaciones_sitios.sql"
)

linea_patron=$(grep -m1 '^PATRON_NO_ADITIVO=' "$FICHERO_FUENTE" || true)
if [ -z "$linea_patron" ]; then
  echo "No se pudo extraer PATRON_NO_ADITIVO de $FICHERO_FUENTE -- ¿cambió de forma?"
  exit 1
fi
eval "$linea_patron"

# Autocomprobación: si el patrón extraído no reconoce una sentencia no
# aditiva de verdad, no hay que fiarse de que "todo limpio" signifique algo.
# El fichero de prueba vive fuera de supabase/migrations/ a propósito, para
# no colar un DROP de mentira en el filtro real.
directorio_prueba=$(mktemp -d)
trap 'rm -rf "$directorio_prueba"' EXIT
fichero_prueba="$directorio_prueba/no_aditivo_de_prueba.sql"
echo 'drop policy "x" on trabajos;' > "$fichero_prueba"
if ! grep -iqE "$PATRON_NO_ADITIVO" "$fichero_prueba"; then
  echo "Autocomprobación fallida: PATRON_NO_ADITIVO no reconoce un DROP POLICY de prueba. No es fiable."
  exit 1
fi
echo "Autocomprobación OK: el patrón extraído reconoce DDL no aditivo."

es_pre_automatizacion() {
  local nombre="$1" candidata
  for candidata in "${MIGRACIONES_PRE_AUTOMATIZACION[@]}"; do
    [ "$candidata" = "$nombre" ] && return 0
  done
  return 1
}

rechazadas=0
for fichero in supabase/migrations/*.sql; do
  nombre=$(basename "$fichero")
  es_pre_automatizacion "$nombre" && continue
  if grep -iqE "$PATRON_NO_ADITIVO" "$fichero"; then
    echo "RECHAZADA (el job aplicar-migraciones no la aceptaría): $fichero"
    grep -inE "$PATRON_NO_ADITIVO" "$fichero" || true
    rechazadas=1
  fi
done

if [ "$rechazadas" -eq 1 ]; then
  echo ""
  echo "Al menos una migración pendiente no es puramente aditiva."
  echo "Corrígela ahora: el job aplicar-migraciones la rechazaría entera tras el merge a main."
  exit 1
fi

echo "Todas las migraciones posteriores a la automatización (issue #181) pasan el filtro aditivo real."
