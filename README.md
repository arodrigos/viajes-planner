# viajes-planner

## Qué es esto

Planificador de viajes turísticos personal y familiar. Recibe criterios y
limitaciones y devuelve un plan optimizado por días, con una guía
interactiva en destino.

Es un producto **personal, sin monetización**. De esa condición dependen el
plan Hobby de Vercel, OpenFreeMap y la reutilización de contenido con
licencia compartir igual. Las reglas que impone al código están en
`CLAUDE.md`.

## Funcionalidades

- **Acceso con código por correo**: solo pueden pedirlo los correos de la
  lista blanca (`CORREOS_PERMITIDOS`).
- **Criterios del viaje**: destino o tipo de viaje, fechas o época, número
  de días, personas y edades, perfil, presupuesto, cómo moverse entre
  ciudades, ritmo, intereses y, opcionalmente, el alojamiento ya reservado.
- **Vista por días**: resumen del viaje, selector de día, un solo mapa y
  menú de opciones. Incluye la ruta entre ciudades, los eventos de cada día
  y «Más sitios recomendados».
- **Tarjeta de parada** compacta, con paneles que se abren de uno en uno:
  por qué se propone, consejos y curiosidades, y alternativas.
- **Tarjeta «Ahora»** en el día de hoy: siguiente parada, progreso, hora
  de salida hacia la siguiente y marcar como visitada.
- **Tramos** entre paradas consecutivas (medio, tiempo estimado y enlace),
  calculados por distancia, sin API de rutas.
- **Alternativas**: sustituir una parada por una alternativa, con su guía.
- **Reordenar paradas** de un día arrastrándolas, con aviso de guardado,
  «Deshacer» y «Reintentar». Si el plan cambió en otra pantalla, recoloca
  las paradas con la versión más reciente y lo dice como información.
- **Añadir un sitio** propio a un día, con nombre y nota opcional (con
  «Deshacer»), y decir a mano la ciudad cuando no se ha podido identificar.
- **Compartir**: el dueño da acceso de solo lectura a su plan por correo; la
  persona invitada no ve importes ni alojamiento.
- **Añadir al calendario**: descarga un `.ics` del plan.
- **Infografía**: lámina del plan, visible dentro de él.
- **Sin conexión**: la app se instala (PWA), guarda una copia del plan para
  abrirlo sin red y permite «Guardar mapas para usar sin red».
- **Opiniones y horario · Google Maps**: panel de la tarjeta de parada con la
  ficha oficial de Google del sitio, solo para las paradas casadas con su
  lugar de Google.
- **Mis viajes**: Próximos y Pasados, con fechas legibles y la situación de
  cada viaje; eliminar un viaje, pedir otro y regenerar un plan.
- **Páginas públicas**: `/guia` (cómo funciona la aplicación), `/terminos` y
  `/privacidad`, enlazadas en el pie.

## Stack y dependencias

- **Next.js (App Router) + TypeScript** estricto, desplegado en **Vercel**.
- **Supabase** (Postgres, Auth y RLS) dentro de un proyecto compartido, con
  el esquema propio `viajes_planner`. Los datos solo los lee y escribe el
  servidor con la clave de servicio: `anon` y `authenticated` no tienen
  ningún privilegio sobre el esquema (migración 035), así que la API REST les
  responde «permiso denegado». Toda migración que cree una tabla, secuencia
  o función repite su `revoke` a `anon`/`authenticated` y el `grant` a
  `service_role`; `scripts/verificar-bd-prueba.sh privilegios` lo comprueba
  y `scripts/verificar-privilegios-reales.sh` lo vigila en DEV tras migrar.
- Mapa con **MapLibre** sobre **OpenFreeMap**. Lugares y fotos desde
  **Nominatim**, **Overpass API** y **Wikipedia/Wikimedia Commons/Wikidata**:
  servicios abiertos y sin cuenta (detalle en `docs/fuentes-de-datos.md`).
- **Google Maps Platform**, solo en la capa gratuita y con dos usos
  acotados: Places Text Search desde el trabajador para casar el `place_id`
  y el Places UI Kit (`gmp-place-details`, vía `@googlemaps/js-api-loader`)
  en el navegador para la ficha. Lo único que se guarda de Google es el
  `place_id`.
- **Serwist** para la PWA y la copia sin conexión, **dnd-kit** para arrastrar
  paradas e **ics** para el calendario.
- Tests: **Vitest** (unitarios y de integración) y **Playwright** (e2e en
  móvil y escritorio, con goldens visuales).

## Arquitectura / estructura de carpetas

Dos mitades que no se pisan:

- **Web (Vercel).** Sirve la interfaz, guarda los viajes y encola trabajos
  en la base de datos. No habla con ningún modelo y no tiene ninguna
  credencial de modelo.
- **Trabajador (fuera de Vercel).** Un tick por cron toma trabajos de la
  cola y los resuelve con Claude Code en modo no interactivo, bajo una
  suscripción y no con una clave de API facturada por token.
  - Entrada: `scripts/trabajador-tick.ts`.
  - Lógica: `src/lib/trabajador/`.
  - En cada tick también rellena y reprocesa lo guardado con un formato
    antiguo (`docs/relleno-de-planes.md`) y casa con Google los lugares
    pendientes (ver más abajo).
  - Todas las fases del barrido de un tick comparten un único cupo de **120
    peticiones** a servicios externos (Nominatim, Wikipedia/Commons,
    Overpass; `PRESUPUESTO_PETICIONES_POR_TICK` en
    `src/lib/trabajador/presupuestoTick.ts`), repartido en orden de
    prioridad: lo que no cabe espera al siguiente tick. Cuenta también las
    llamadas que resuelve la caché, así que es una cota superior. El
    resultado del tick lo publica como `peticiones_externas`.

### Curiosidades verificadas

Las curiosidades de cada parada son frases **literales** de Wikipedia y
Wikidata. El modelo solo elige, entre candidatas ya extraídas y saneadas,
cuáles mostrar; no redacta ninguna.

- Las reglas que deciden qué frase vale (saneado, cortes de frase,
  abreviaturas, siglas, edificio frente a institución) tienen una huella
  (`src/lib/guia/huella.ts`).
- `MIN_FRASE` (`src/lib/guia/candidatas.ts`, hoy **15**) es la longitud
  mínima, en caracteres, de una frase candidata; el máximo es `MAX_FRASE`
  (300). Bajó de 20 a 15 para no descartar frases cortas con año del tipo
  «It opened in 1910.». Los dos umbrales forman parte de la huella.
- `FORMATO_CURIOSIDADES` (`src/lib/guia/curiosidadesPlan.ts`, hoy **6**) es
  la versión de esas reglas. Si cambian las reglas o los umbrales sin subir
  el formato, falla el test de la huella.
- Al subir el formato, el trabajador rehace las curiosidades de la última
  versión de cada plan guardado (reproceso). `/api/salud` cuenta las que
  aún están en un formato antiguo.

### Google: casado del `place_id` y ficha

**Casado en el trabajador** (`src/lib/trabajador/google/casar.ts`). En cada
tick, si el trabajador tiene `GOOGLE_PLACES_CLAVE`:

- Toma las paradas de la última versión de cada plan con lugar comprobado
  (OSM o Wikipedia) y coordenadas, una por lugar y con el viaje más próximo
  primero. Sin ancla no hay petición.
- Solo llama a Places **Text Search** cuando el lugar no tiene fila en
  `lugares_google`, cuando está `obsoleto` o en `error`, cuando lleva más de
  30 días `sin-coincidencia` o cuando su casado tiene más de 12 meses.
- Pide solo `places.id` y `places.location` con el nombre de la parada y la
  ciudad, restringido a un rectángulo alrededor del ancla. Acepta el primer
  resultado a menos de 300 m (1.000 m en parques, playas, naturaleza,
  barrios, plazas y miradores) y descarta la ubicación.
- Como mucho 20 lugares por tick. Antes de cada petición reserva cupo con
  `reservar_cupo_google`: Text Search tiene un tope propio de **45 al día** y
  1.350 al mes, por debajo de la cuota de la consola. Si no hay cupo, o si el
  contador falla, para y deja el resto para otro tick.
- Sin clave no hace nada (así corren el desarrollo local y los tests).

**Ficha en la UI** (`src/app/plan/[id]/FichaGoogle.tsx`). La tarjeta de
parada tiene el panel «Opiniones y horario · Google Maps»; la tarjeta
«Ahora» y el aviso de horario de OSM («Compruébalo en Google») lo abren. No
se contacta con Google hasta la primera apertura. Entonces la página pide el
`place_id` a `POST /api/google/ficha`, que comprueba la sesión y que el plan
es del usuario, y reserva una carga de UI Kit (tope propio de 250 al día,
7.500 al mes y 80 por usuario y día). El navegador solo conoce el estado de
cada parada (`casado`, `sin-coincidencia`, `pendiente`, `sin-ubicacion`); el
`place_id` solo sale por esa ruta. Si Google responde `NOT_FOUND`, el lugar
se marca `obsoleto` y el trabajador lo vuelve a casar. Sin clave de
navegador, sin casar o sin cupo, el panel lo dice y enlaza a Google Maps.

### Orden de paradas

`POST /api/plan/[id]/orden` guarda el orden de un día como una versión nueva
del plan, con la función SQL `reordenar_dia_plan` (solo `service_role`).
Responde 409 `version-desfasada` si la última versión no es la que la persona
tenía en pantalla, y la UI recoloca las paradas con la versión más reciente y
enseña un aviso informativo.

La función bloquea la fila del plan (`for update`), pero los clones de
versión del trabajador no lo hacen. Si un clon se lleva la versión N+1 entre
la lectura de la última versión y el insert de la reordenación, salta el
`unique (plan_id, version)` (`unique_violation`, SQLSTATE 23505). La función
(migración 034) traduce ese error a `version-desfasada`, y la ruta (y
`errorDeFuncionSitio` para los sitios propios) trata además cualquier error
con `code` 23505 como 409, nunca como 500. El CI lo comprueba contra la pila
local de Supabase:
`BD_URL=<url de la base de pruebas> bash scripts/verificar-bd-prueba.sh choque`.

### Salud del despliegue

`GET /api/salud` responde 200 si todo está en orden y 503 si no. Informa de:

- la conexión con Supabase y el esquema;
- cuándo se vio por última vez al trabajador, su commit y su último
  resultado;
- los secretos que faltan, y que no haya credenciales de modelo en la web;
- `relleno`: contadores agregados del relleno (paradas resueltas, con foto,
  guía, alternativas, `curiosidades_formato_antiguo`, planes con ciudad…).
  Salen de una sola llamada por rpc a la función SQL `estado_relleno`, a la
  que se pasa el `FORMATO_CURIOSIDADES` vigente, con 60 s de caché en
  memoria. Solo se publica si trae exactamente las claves esperadas y todas
  son enteros no negativos. Una segunda rpc, `estado_relleno_motivos`, añade
  por qué quedan paradas «no-resuelta» (`paradas_no_resueltas_*`, por
  `resolucion.categoria_motivo`), el denominador `paradas_con_toponimo` y
  `paradas_sin_intentar_ultima_version`; si falla o aún no existe, `relleno`
  sale igual sin esas siete claves;
- `google`: `text_search_hoy`, `text_search_mes`, `ui_kit_hoy` y `ui_kit_mes`
  (por rpc a `consumo_google_resumen`, con el día de Google, hora del
  Pacífico), `lugares_casados` y `lugares_sin_coincidencia` (recuentos de
  `lugares_google`), y `clave_trabajador` y `clave_navegador`, que valen 1 o
  0 según la clave esté presente. Nunca expone el valor de una clave ni un
  `place_id`;
- la pasada de alternativas del trabajador.

Si falla la lectura de `relleno` o de `google`, ese bloque se omite y el
resto de la respuesta sigue. Nunca devuelve texto crudo de errores. El cron diario de Vercel la llama a
las 07:00 UTC (`vercel.json`).

```
src/app/            páginas (criterios, plan, guía, mis viajes, términos, privacidad) y API (acceso, auth, plan, trabajos, viajes, google, salud)
src/lib/plan/       modelo del plan, días y tramos entre paradas
src/lib/lugares/    resolución de lugares, ciudades y fotos con fuentes abiertas
src/lib/guia/       consejos y curiosidades de cada parada (reglas, huella y reproceso)
src/lib/alternativas/  alternativas de paradas y su equivalencia
src/lib/infografia/ lámina del plan
src/lib/google/     cupo de Google, estados por parada, ficha y resumen para /api/salud
src/lib/cola/, src/lib/trabajador/  cola de trabajos y su procesado (incluido el casado con Google)
src/verificacion/   suite preview de Playwright contra un despliegue publicado
src/lib/db/         cliente de Supabase atado al esquema del producto
supabase/migrations/  migraciones versionadas y solo aditivas (hoy hasta la 035)
docs/               fuentes de datos, guía de estilo, relleno de planes, verificación con sesión y viajes por país
.github/workflows/  CI, reintento del CI y «Pruebas a demanda»
```

## Ramas y despliegue

- **`dev`** es la rama de trabajo y la rama por defecto. Los PRs van contra
  `dev`. Un push a `dev` pasa el CI, aplica las migraciones pendientes al
  Supabase de desarrollo y despliega la preview de Vercel, protegida con
  login.
- **Solo `dev` despliega en Vercel.** `vercel.json` desactiva los
  despliegues automáticos de cualquier otra rama
  (`git.deploymentEnabled`): los PRs y las ramas de trabajo no generan
  preview y solo se validan en el CI.
- **`main` es congelación, no despliegue.** Un merge a `main` marca una
  versión cerrada con su tag, pero no despliega nada. Pasar algo a
  producción es una decisión explícita, aparte, y con su propio
  procedimiento. Nadie mergea a `main` por su cuenta, aunque el cambio sea
  solo de CI o de documentación.
- El trabajador corre sobre la cabeza de `dev` y se actualiza solo antes de
  cada tick.

## Cómo arrancar en local

```bash
npm install
cp .env.example .env.local   # y rellena las variables de abajo
npm run dev
```

`npm install` copia además el worker de MapLibre a `public/` (`postinstall`).
`npm run build` falla si `CORREOS_PERMITIDOS` está vacía (`prebuild`). El
trabajador se lanza aparte con `npm run trabajador:tick`.

## Variables de entorno necesarias

Están en `.env.example`, salvo `SALUD_ORIGEN_TRABAJADOR`. Nunca se suben al
repo.

| Variable | Para qué |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase compartido (el de desarrollo en local y CI) |
| `SUPABASE_ANON_KEY` | Clave anónima: solo para el acceso con código por correo (`.auth.*`); no lee ni escribe datos |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio, solo en servidor |
| `SUPABASE_SCHEMA` | `viajes_planner`. Sin ella, el cliente falla en vez de caer a `public`, que es de otro producto |
| `CRON_SECRET` | Autoriza el cron diario de Vercel sobre `/api/salud` |
| `CORREOS_PERMITIDOS` | Lista blanca de correos que pueden pedir acceso. El build falla si está vacía |
| `NEXT_PUBLIC_GOOGLE_MAPS_CLAVE_NAVEGADOR` | Clave de navegador de Google (Maps JavaScript API y Places UI Kit) para la ficha. Se fija antes del build. Opcional: sin ella el panel avisa y enlaza a Google Maps |
| `SALUD_ORIGEN_TRABAJADOR` | Origen con el que el **trabajador** apunta sus filas de salud y que `/api/salud` busca: si se fija, con el mismo valor en los dos entornos. Opcional: por defecto `trabajador` |
| `GOOGLE_PLACES_CLAVE` | Solo en el entorno del **trabajador**, nunca en la web. Clave de Places API (New) para Text Search. Sin ella no se casa nada |

Ninguna variable de modelo entra en el despliegue web: `/api/salud` avisa si
ve `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` o `CLAUDE_API_KEY`. Las
restricciones y cuotas de las dos claves de Google se configuran a mano en su
consola (`docs/fuentes-de-datos.md`, «Google Maps Platform»).

Opcionales, con valor por defecto en el código (no están en `.env.example`):

| Variable | Dónde se lee | Para qué |
|---|---|---|
| `TRABAJOS_LIMITE_POR_HORA`, `TRABAJOS_ARRENDAMIENTO_MIN`, `TRABAJOS_CADUCIDAD_HORAS` | `src/lib/cola/config.ts` | Trabajos por hora y usuario, arrendamiento de un trabajo y caducidad de los que nadie recoge |
| `TRABAJADOR_MODELO`, `TRABAJADOR_CERROJO_TTL_MIN`, `TRABAJADOR_ESPERA_OCIOSA_MS`, `TRABAJADOR_INTERVALO_OCIOSO_MS` | `src/lib/trabajador/config.ts` | Modelo de generación, cerrojo y espera ociosa del trabajador |
| `COMMIT_SHA` | `src/lib/salud.ts` | Commit que publica `/api/salud` fuera de Vercel (en Vercel sale de `VERCEL_GIT_COMMIT_SHA`) |
| `NEXT_PUBLIC_SW_DESACTIVADO` | `src/app/RegistroSinConexion.tsx` | Con `1`, el siguiente despliegue desregistra el service worker y vacía su copia |

La suite preview lee además las suyas (ver abajo).

## Cómo correr los tests

```bash
npm run lint
npm run typecheck
npm test                     # unitarios (Vitest)
npm run test:integration     # contra la pila local de Supabase (supabase start)
npm run test:e2e             # Playwright: proyectos chromium y movil
npm run verificar:esqueleto  # build + arranque de producción + /api/salud + no-afiliación
```

Los de integración y los e2e necesitan la pila local de Supabase levantada
con la CLI de Supabase (`supabase start`, configuración en
`supabase/config.toml`) y las variables `SUPABASE_*` apuntando a ella, como
hace el CI. Las comprobaciones SQL de `scripts/verificar-bd-prueba.sh`
(`relleno`, `cupo`, `permisos`, `lugares`, `obsoleto`, `orden`, `choque`,
`privilegios`) van contra esa misma base con `BD_URL`.

### Suite preview (contra un despliegue publicado)

Los ficheros `*.preview.e2e.ts` (`src/verificacion/`) forman el proyecto
`preview` de Playwright, que **solo existe si se define `URL_OBJETIVO`**: no
arranca ni compila la app, va contra un despliegue ya publicado, con un
usuario de pruebas con sesión y un plan real. Nunca corre en el CI ni en
GitHub Actions; el CI comprueba que sin `URL_OBJETIVO` no se lista ningún spec
preview.

```bash
URL_OBJETIVO=https://… CORREO_ACCESO=… CODIGO_ACCESO=… npm run preparar:plan-prueba
URL_OBJETIVO=https://… npx playwright test --project=preview
```

Variables de la suite:

- `URL_OBJETIVO`: el despliegue contra el que se corre.
- `CORREO_ACCESO` y `CODIGO_ACCESO`: el usuario de pruebas y su código de un
  solo uso.
- `CORREO_INVITADO` y `CODIGO_INVITADO`: el segundo usuario de pruebas, el
  invitado de «Compartir» (`src/app/plan/[id]/compartir.preview.e2e.ts`).
  Opcionales: sin ellos esos casos se saltan, no pasan en verde.
- `PLAN_PRUEBA_ID`, `VERCEL_SESION`, `VERIFICACION_DIR` y
  `VERIFICACION_SOLO_ENCOLAR`: opcionales.

Qué hace cada una, tiempos, casos y qué correos están en qué lista en
`docs/verificacion-con-sesion.md`.

### Pruebas a demanda

El workflow «Pruebas a demanda» (`.github/workflows/pruebas-a-demanda.yml`)
se lanza a mano (`workflow_dispatch`) para ejecutar en Actions specs
concretos de una rama. Entradas:

- `tipo`: `e2e` (Playwright contra la pila local de Supabase, como el job e2e
  del CI) o `unit` (Vitest);
- `specs`: ficheros o filtros separados por espacios; vacío ejecuta todos.

Valida las dos entradas antes de usarlas y, si falla un e2e, deja cada test
fallido como anotación del run.

```bash
gh workflow run "Pruebas a demanda" --ref <rama> -f tipo=unit -f specs="src/lib/guia"
```

## Changelog de cambios relevantes

- **2026-10-17**:
  - **Cupo único de peticiones por tick** (#251): antes cada fase del barrido
    tenía su propio tope de 120, así que un tick podía sumar varias veces ese
    número; ahora comparten uno solo (`peticiones_externas` en el resultado
    del tick).
  - **Motivo de las paradas no resueltas** (migración 028): el resolutor
    guarda `resolucion.categoria_motivo` (`sin-candidatos`, `fuera-de-caja`,
    `nombre-distinto`, `tipo-incompatible`), y la función nueva
    `estado_relleno_motivos` suma a `/api/salud.relleno` siete contadores: el
    desglose por motivo, `paradas_con_toponimo` y
    `paradas_sin_intentar_ultima_version`. `estado_relleno` no cambia.
- **2026-10-08**:
  - **Curiosidades** (#207): `MIN_FRASE` baja de 20 a 15, los umbrales entran
    en la huella y `FORMATO_CURIOSIDADES` sube a 6.
  - **Términos y privacidad** (#214): páginas públicas `/terminos` y
    `/privacidad`, enlazadas en el pie, con el aviso de contenido de Google
    Maps y qué datos salen a cada servicio.
  - **Cupo de Google** (#217, migración 026): tablas `topes_google`,
    `consumo_google` y `consumo_google_usuario` y funciones
    `reservar_cupo_google` y `consumo_google_resumen`; bloque `google` en
    `/api/salud`.
  - **Casado del `place_id`** (#219, migración 027 `lugares_google`): el
    trabajador casa las paradas comprobadas con Text Search, con
    `GOOGLE_PLACES_CLAVE`.
  - **Ficha de Google** (#220, #221, #223): panel «Opiniones y horario ·
    Google Maps» en la tarjeta de parada, con
    `NEXT_PUBLIC_GOOGLE_MAPS_CLAVE_NAVEGADOR`.
  - **Aviso de horario** (#222): el horario de OSM dice su fuente y su
    antigüedad y ofrece comprobarlo en la ficha de Google.
  - **Sustitución rápida** (#216, migración 025): `clonar_version_plan` copia
    la última versión de un plan dentro de la base, y las alternativas nacidas
    de una parada sustituida guardan `motivo_parada` y `coste_parada` para
    devolvérselos al deshacer.
  - **Relleno en `/api/salud`** (#205): una sola función SQL por rpc.
  - **Suite preview** (#208, #209, #210, #213, #218): Playwright con sesión
    real contra un despliegue publicado, solo con `URL_OBJETIVO`.
  - **Pruebas a demanda** (#215): workflow manual con entradas `tipo` y
    `specs`.
  - **Origen de salud del trabajador** (#245): el origen con el que el
    trabajador apunta sus filas de salud sale de `SALUD_ORIGEN_TRABAJADOR`
    (por defecto `trabajador`), y `/api/salud` publica el modo de acceso al
    modelo como `suscripcion`.
  - **Fotos de la ficha de Google** (#246): la ficha solo muestra las fotos
    de Google cuando la parada no tiene foto propia.
- **Curiosidades** (#160, #163, #171, #191, #192):
  - frases literales de Wikipedia y Wikidata elegidas por el modelo, que no
    las redacta;
  - formato 5, con huella de reglas y reproceso de lo ya guardado;
  - contador del formato antiguo en `/api/salud`.
- **Vista por días** (#166): resumen, selector de día, un solo mapa y menú de
  opciones.
- **Tarjeta de parada** (#167): compacta, con tres paneles exclusivos.
- **Tarjeta «Ahora»** (#168, #169, #189): siguiente parada del día de hoy,
  hora de salida destacada y nombre accesible por parada.
- **Errores por parada** (#188): el fallo de una parada o de una visita se ve
  en su sitio.
- **Mis viajes** (#165, #190): Próximos y Pasados, orden por fecha, rango
  legible y situación del viaje.
- **Guía de estilo y catálogo de textos** (#165): `docs/guia-de-estilo.md`,
  con comprobación de accesibilidad (axe) en los e2e.
- **Solo `dev` despliega** (#162): las demás ramas no generan preview en
  Vercel.
- **Alternativas con guía** (#158, #159): guardado en bloque, estado visible,
  y la parada nueva hereda la guía de la alternativa.
- **Guía**: consejos completos con «Ver más», curiosidades literales de
  Wikipedia/Wikidata y enlaces de mapa y fuente en cada parada.
- **Tramos del día**: medio, tiempo estimado y enlace entre paradas
  consecutivas, calculados por distancia sin API de rutas.
- **Alternativas**: elegir una alternativa rápida o con su guía, con
  guardado en bloque y estado visible.
- **Infografía**: lámina multiciudad de hasta 7 días, visible dentro del
  plan.
- **Seguridad**: next 16.3.6 (CVE-2026-94545); licencias solo por https;
  `/api/salud` sin texto crudo de errores.
- **Mis viajes**: lista, eliminar y pedir otro viaje; regenerar un plan
  existente.
