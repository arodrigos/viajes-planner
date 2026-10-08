# Verificación con sesión contra un despliegue

Casos que necesitan un usuario con sesión y un plan real no se pueden juzgar
con el CI (que siembra planes con datos fijos). Esta suite los ejecuta contra
un despliegue de la rama `dev`, con un usuario de pruebas y el plan que genera
el trabajador de verdad.

## Qué es y qué no es

- Es el proyecto `preview` de Playwright. Solo existe si hay `URL_OBJETIVO`:
  sin ella, `npx playwright test --list` no lista ningún `*.preview.e2e.ts` y
  el CI no cambia.
- No arranca ni compila la app: `baseURL` es `URL_OBJETIVO` y no hay servidor local.
- Las aserciones son estructurales (el plan no es determinista). Los goldens
  exactos siguen en el CI.

## Variables

| Variable | Para qué |
| --- | --- |
| `URL_OBJETIVO` | URL base del despliegue a verificar. Activa el proyecto. |
| `VERCEL_SESION` | Fichero `storageState` con la sesión que pasa la protección del despliegue (opcional si no está protegido). |
| `CORREO_ACCESO`, `CODIGO_ACCESO` | Usuario de pruebas y su código de acceso de un solo uso. Nunca se imprimen. |
| `PLAN_PRUEBA_ID` | Reutiliza un plan existente del usuario de pruebas: no se crea ningún trabajo. Tiene prioridad sobre todo lo demás. |
| `VERIFICACION_DIR` | Dónde se guardan sesión, plan y capturas. Por defecto `artefactos/verificacion`, que git ignora. |
| `VERIFICACION_BORRAR` | Con `1`, el plan que creó la suite se borra al terminar. Sin ella se conserva, porque regenerarlo cuesta unos 38 minutos. |
| `VERIFICACION_SOLO_ENCOLAR` | Con `1`, el setup inicia sesión, encola (o reutiliza) el trabajo, escribe su id en `plan.json` y sale sin esperar. Lo usa `npm run preparar:plan-prueba`. |

## Cuánto tarda y cómo prepararlo

Tiempos medidos: un plan multiciudad de 10 días tarda unos 28 minutos en estar
«completado» y unos 10 más en tener el relleno de guía y curiosidades que
exigen los casos; un viaje de una sola ciudad, de 8 a 10 minutos. **Una pasada
de juicio de 60 minutos no puede generar el plan y además juzgarlo**: el plan
se prepara antes o se reutiliza.

1. Primer paso de la pasada, antes de cualquier otra comprobación:

   ```bash
   URL_OBJETIVO=https://… VERCEL_SESION=sesion-vercel.json \
   CORREO_ACCESO=… CODIGO_ACCESO=… \
   npm run preparar:plan-prueba
   ```

   Termina en menos de 2 minutos. Si ya hay un plan útil, un trabajo en curso o
   un `plan.json` de una pasada anterior, lo reutiliza; si no, encola uno y
   escribe `{ "trabajoId": … }` en `VERIFICACION_DIR/plan.json`.
2. Mientras el trabajador genera, se hacen las comprobaciones estáticas.
3. La suite normal retoma desde ahí, con las mismas variables:

   ```bash
   npx playwright test --project=preview
   ```

## Cómo se resuelve el plan

El global setup canjea el código por la sesión (el código es de un solo uso:
no se pide otro por el formulario), la guarda en `VERIFICACION_DIR` y resuelve
el plan **reutilizando antes de crear**, por este orden:

1. `PLAN_PRUEBA_ID`, si el plan es visible para el usuario de pruebas.
2. El `id` de `plan.json`, si el plan sigue visible y es útil.
3. El plan más reciente del usuario con el destino de prueba, de menos de 7
   días (se estima por la fecha de inicio, que se fija a 60 días vista al
   crearlo) y útil. Se lee de la misma API que usa Mis viajes. Si es reciente
   pero aún le falta el relleno, se espera a su trabajo en vez de generar otro.
4. Un trabajo del usuario encolado o en curso (o el `trabajoId` de `plan.json`):
   se sondea ese mismo trabajo.
5. Solo si no hay nada de lo anterior, pide por el formulario real un plan de
   «Portugal» (el producto lo trata como viaje de varias ciudades) de 10 días,
   con 4.000 € de presupuesto, inicio a 60 días vista y 2 adultos.

Un plan es útil con al menos 2 etapas, la mitad de las paradas ubicadas y, de
las comprobadas, al menos la mitad con curiosidades y la mitad con
alternativas. Un plan sin etapas o sin ubicar falla enseguida con el motivo;
uno completado al que aún le falta el relleno se sigue sondeando dentro del
mismo límite y, al agotarlo, falla con «el plan aún no tiene guía y
curiosidades». El sondeo es cada 30 s y como máximo 40 minutos; si el
trabajador no termina, falla con «el trabajador no ha generado el plan a
tiempo».

El plan se conserva al terminar. Ojo: `pv-alr-02`, `pv-alg-02` y `pv-alg-01`
sustituyen y deshacen paradas, así que no conviene reutilizar el mismo plan
indefinidamente; con `VERIFICACION_BORRAR=1` el que creó la suite se borra con
el mismo borrado que «Eliminar» de Mis viajes.

Si `GET /api/plan/<id>` responde 500, el cuerpo trae `paso` (`plan`, `version`,
`paradas`, `alternativas`, `visitas` o `presentar`) y `detalle` con el mensaje
del error, sin datos del plan: sirve para reproducirlo desde el preview sin
leer los logs de la función.

## Casos

Cada título lleva el id del caso: `pv-ie2e-01`, `pv-ie2e-02`, `pv-ip-01`,
`pv-enl-01`, `pv-cc-02`, `pv-tra-02`, `pv-alr-02`, `pv-alg-02`, `pv-cur-03`
(UI), `pv-nps-02` y `pv-alg-01` (API), `pv-trabajador` y `pv-ficha-real`
(ficha de Google; necesita la clave de navegador real en el despliegue y, sin
ella, se salta en vez de fallar). Los casos de la base
de datos van en `scripts/verificar-bd-prueba.sh` (`BD_URL` con la URL de la
base de prueba).

## Qué no verifica

El detalle tick a tick del trabajador (cuatro casos internos) lo cubre el job
`persistencia` del CI; aquí solo se juzga su efecto en el plan real.
