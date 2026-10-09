# viajes-planner

## Qué es esto

Planificador de viajes turísticos personal y familiar. Recibe criterios y
limitaciones (fechas, ciudades, ritmo, si se viaja con niños) y devuelve un
plan optimizado por días, con una guía interactiva en destino:

- **Vista por días**: resumen del viaje, selector de día, un solo mapa y
  menú de opciones.
- **Tarjeta de parada** compacta, con tres paneles que se abren de uno en
  uno: por qué se propone, consejos y curiosidades, y alternativas.
- **Tarjeta «Ahora»** en el día de hoy: siguiente parada, progreso, hora
  de salida hacia la siguiente y marcar como visitada.
- Tramos entre paradas, alternativas con su guía y sitios visitados.
- **Mis viajes**: ordenados en Próximos y Pasados, con fechas legibles y la
  situación de cada viaje.
- **Opiniones y horario · Google Maps**: panel de la tarjeta de parada con la
  ficha oficial de Google del sitio (valoración, horario, reseñas y fotos),
  solo para las paradas casadas con su lugar de Google.
- **Términos y privacidad**: `/terminos` y `/privacidad`, públicas y
  enlazadas en el pie.

También genera una infografía del plan.

Es un producto **personal, sin monetización**. De esa condición dependen el
plan Hobby de Vercel, OpenFreeMap y la reutilización de contenido con
licencia compartir igual. Las reglas que impone al código están en
`CLAUDE.md`.

## Stack y dependencias

- **Next.js (App Router) + TypeScript** estricto, desplegado en **Vercel**.
- **Supabase** (Postgres, Auth y RLS) dentro de un proyecto compartido, con
  el esquema propio `viajes_planner`.
- Mapa con **MapLibre** sobre **OpenFreeMap**. Lugares y fotos desde
  **Nominatim**, **Overpass API** y **Wikipedia/Wikimedia Commons/Wikidata**:
  servicios abiertos y sin cuenta (detalle en `docs/fuentes-de-datos.md`).
- **Google Maps Platform**, solo en la capa gratuita y con dos usos
  acotados: Places Text Search desde el trabajador para casar el `place_id`
  y el Places UI Kit (`gmp-place-details`, vía `@googlemaps/js-api-loader`)
  en el navegador para la ficha. Lo único que se guarda de Google es el
  `place_id`.
- Tests: **Vitest** (unitarios y de integración) y **Playwright** (e2e en
  móvil, con goldens visuales).

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
  son enteros no negativos;
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
src/app/            páginas (criterios, plan, guía, mis viajes, términos, privacidad) y API (acceso, plan, trabajos, viajes, google, salud)
src/lib/plan/       modelo del plan, días y tramos entre paradas
src/lib/lugares/    resolución de lugares, ciudades y fotos con fuentes abiertas
src/lib/guia/       consejos y curiosidades de cada parada (reglas, huella y reproceso)
src/lib/alternativas/  alternativas de paradas y su equivalencia
src/lib/infografia/ lámina del plan
src/lib/google/     cupo de Google, estados por parada, ficha y resumen para /api/salud
src/lib/cola/, src/lib/trabajador/  cola de trabajos y su procesado (incluido el casado con Google)
src/verificacion/   suite preview de Playwright contra un despliegue publicado
src/lib/db/         cliente de Supabase atado al esquema del producto
supabase/migrations/  migraciones versionadas (solo aditivas)
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

## Variables de entorno necesarias

Están en `.env.example`. Nunca se suben al repo.

| Variable | Para qué |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase compartido (el de desarrollo en local y CI) |
| `SUPABASE_ANON_KEY` | Clave anónima: acceso con enlace mágico, siempre detrás de RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio, solo en servidor |
| `SUPABASE_SCHEMA` | `viajes_planner`. Sin ella, el cliente falla en vez de caer a `public`, que es de otro producto |
| `CRON_SECRET` | Autoriza el cron diario de Vercel sobre `/api/salud` |
| `CORREOS_PERMITIDOS` | Lista blanca de correos que pueden pedir acceso. El build falla si está vacía |
| `NEXT_PUBLIC_GOOGLE_MAPS_CLAVE_NAVEGADOR` | Clave de navegador de Google (Maps JavaScript API y Places UI Kit) para la ficha. Se fija antes del build. Opcional: sin ella el panel avisa y enlaza a Google Maps |
| `SALUD_ORIGEN_TRABAJADOR` | Origen con el que el **trabajador** apunta sus filas de salud y que `/api/salud` busca: si se fija, con el mismo valor en los dos entornos. Opcional: por defecto `trabajador` |
| `GOOGLE_PLACES_CLAVE` | Solo en el entorno del **trabajador**, nunca en la web. Clave de Places API (New) para Text Search. Sin ella no se casa nada |

Ninguna variable de modelo entra en el despliegue web. Las restricciones y
cuotas de las dos claves de Google se configuran a mano en su consola
(`docs/fuentes-de-datos.md`, «Google Maps Platform»).

## Cómo correr los tests

```bash
npm run lint
npm run typecheck
npm test                     # unitarios (Vitest)
npm run test:integration     # contra el Supabase de desarrollo
npm run test:e2e             # Playwright, móvil
npm run verificar:esqueleto  # build + arranque de producción + /api/salud + no-afiliación
```

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

Variables, tiempos y casos en `docs/verificacion-con-sesion.md`.

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
