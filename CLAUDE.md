@AGENTS.md

# viajes-planner

Planificador/optimizador de viajes turísticos. Producto **personal y
familiar, sin monetización** — es la condición de la que dependen a la vez
Vercel Hobby, OpenFreeMap y la reutilización de contenido con licencia
compartir igual. No se rompe nunca sin decisión explícita del dueño del producto.

## Arquitectura (resumen; el diseño completo vive en el pipeline horizontal)

Dos mitades que no se pisan. La mitad web (Next.js App Router, Vercel Hobby,
Supabase) sirve la interfaz y encola trabajos; no habla con ningún modelo y
no tiene ninguna credencial de modelo. La mitad que piensa vive en la máquina del trabajador: un
tick por cron toma trabajos de la cola y ejecuta `claude -p` en modo no
interactivo bajo la suscripción del dueño del producto, nunca con una clave de API
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
- Mapa, resolución de lugares y fotos usan los servicios abiertos sin cuenta
  aprobados como decisión de producto (OpenFreeMap, Nominatim,
  Wikipedia/Wikimedia Commons, Overpass API). Google Maps Platform entra solo
  en dos usos, ambos dentro de su capa gratuita:
  1. Text Search desde el trabajador, pidiendo id y ubicación, para casar el
     `place_id` de una parada ya comprobada (la ubicación se usa para validar
     y se descarta).
  2. Places UI Kit en el navegador, solo con sesión, como ficha de la parada.
  Nunca se guarda nada de Google salvo el `place_id`; nunca contenido de
  Google al modelo; nunca en `/guia`; nunca precios; nunca junto a otro
  proveedor de Places. Cada tope de cupo sube solo con una migración nueva y
  el cambio en la consola de Google. Detalle en `docs/fuentes-de-datos.md`.

## Capturas

Los bloques con interfaz producen capturas con `capturar(page, bloque, nombre)`
de `src/test-utils/capturas.ts`, que las guarda en
`artefactos/capturas/<bloque>/<nombre>.png` y tapa todo texto con «@» y los
nodos con `data-sensible`: el repo es público y el artefacto también se lee
fuera. Cada captura se declara en `src/test-utils/capturas-esperadas.ts` en el
mismo PR que la genera; el paso «comprobar capturas» del job e2e falla si falta
alguna. El entregable de cada bloque con UI cita el artefacto `capturas-movil`,
el id de la ejecución de Actions y las rutas dentro del artefacto.

## Evidencia de los criterios

Cuando un criterio de aceptación se da por cumplido, su evidencia empieza
por el comando exacto que la reproduce, para que cualquiera pueda volver a
ejecutarlo tal cual:

- Unitarios: `npx vitest run <ruta completa>`.
- Integración: `npx vitest run --config vitest.integration.config.mts <ruta completa>`.
- e2e: `npx playwright test <ruta completa>`.
- Scripts: `npm run <script>`.

Reglas:

- La ruta va completa desde la raíz del repo, con los corchetes de las
  rutas dinámicas incluidos (`[id]`). Una ruta abreviada o sin corchetes no
  se puede reproducir ni comprobar con una búsqueda de texto.
- Entre el comando y la ruta no hay paréntesis ni comillas ni texto.
- Si el criterio nombra varios ficheros de test, la evidencia cita la ruta
  de cada uno.

Ejemplo:

`npx playwright test src/app/plan/[id]/infografia.movil.e2e.ts`
