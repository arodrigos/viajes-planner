@AGENTS.md

# viajes-planner

Planificador/optimizador de viajes turísticos. Producto **personal y
familiar, sin monetización** — es la condición de la que dependen a la vez
Vercel Hobby, OpenFreeMap y la reutilización de contenido con licencia
compartir igual. No se rompe nunca sin decisión explícita de Adrián.

## Arquitectura (resumen; el diseño completo vive en el pipeline horizontal)

Dos mitades que no se pisan. La mitad web (Next.js App Router, Vercel Hobby,
Supabase) sirve la interfaz y encola trabajos; no habla con ningún modelo y
no tiene ninguna credencial de modelo. La mitad que piensa vive en VPS1: un
tick por cron toma trabajos de la cola y ejecuta `claude -p` en modo no
interactivo bajo la suscripción de Adrián, nunca con una clave de API
facturada por token.

## Reglas de este repo

- Rama desde `dev` (nunca desde `main` directamente, nunca commits directos
  a `dev` o `main`). Un PR por bloque del diseño horizontal, con el id del
  bloque en el título.
- Comentarios en castellano explicando el *porqué*, nunca el *qué*. Sin
  TODOs huérfanos, sin abstracciones para un solo caso de uso.
- Test permanente de no comercialidad (`scripts/verificar-esqueleto.sh` y
  `src/lib/sin-afiliacion.ts`): ninguna URL de salida lleva parámetros de
  afiliación, ningún script de red publicitaria. Corre en CI desde el primer
  bloque sobre HTML ya renderizado, no solo sobre el código fuente.
- Ninguna credencial de modelo entra jamás en el despliegue web: la mitad
  Vercel no debe importar ni leer ninguna variable de entorno de modelo.
- El campo `commit` de `/api/salud` sale de `VERCEL_GIT_COMMIT_SHA` (o
  `COMMIT_SHA` como equivalente fuera de Vercel), nunca de invocar `git` en
  tiempo de ejecución: en producción no hay `.git` disponible.
- Mapa, resolución de lugares y fotos usan EXCLUSIVAMENTE los cuatro
  servicios abiertos sin cuenta aprobados por Adrián (OpenFreeMap,
  Nominatim, Wikipedia/Wikimedia Commons, Overpass API): nunca Google Maps
  Platform ni ningún otro proveedor de mapas o lugares. Detalle en
  `docs/fuentes-de-datos.md`.
