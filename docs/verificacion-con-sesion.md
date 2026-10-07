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
| `PLAN_PRUEBA_ID` | Reutiliza un plan existente del usuario de pruebas: no se crea ningún trabajo. |
| `VERIFICACION_DIR` | Dónde se guardan sesión, plan y capturas. Por defecto `artefactos/verificacion`, que git ignora. |
| `VERIFICACION_CONSERVAR` | Con `1`, el plan creado por la suite no se borra al terminar. |

## Cómo se ejecuta

```bash
URL_OBJETIVO=https://… VERCEL_SESION=sesion-vercel.json \
CORREO_ACCESO=… CODIGO_ACCESO=… \
npx playwright test --project=preview
```

El global setup canjea el código por la sesión (el código es de un solo uso:
no se pide otro por el formulario), guarda la sesión en `VERIFICACION_DIR` y,
si no hay `PLAN_PRUEBA_ID`, pide por el formulario real un plan de «Portugal»
(el producto lo trata como viaje de varias ciudades) de 10 días, con 4.000 € de
presupuesto, inicio a 60 días vista y 2 adultos. Si el plan no sale con al menos
2 etapas y la mitad de las paradas ubicadas, falla enseguida con el motivo. Después sondea cada
30 s y espera como máximo 40 minutos; si el trabajador no termina, falla con
«el trabajador no ha generado el plan a tiempo». Al acabar borra el plan que
creó, con el mismo borrado que «Eliminar» de Mis viajes.

## Casos

Cada título lleva el id del caso: `pv-ie2e-01`, `pv-ie2e-02`, `pv-ip-01`,
`pv-enl-01`, `pv-cc-02`, `pv-tra-02`, `pv-alr-02`, `pv-alg-02`, `pv-cur-03`
(UI), `pv-nps-02` y `pv-alg-01` (API) y `pv-trabajador`. Los casos de la base
de datos van en `scripts/verificar-bd-prueba.sh` (`BD_URL` con la URL de la
base de prueba).

## Qué no verifica

El detalle tick a tick del trabajador (cuatro casos internos) lo cubre el job
`persistencia` del CI; aquí solo se juzga su efecto en el plan real.
