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
- Tests: **Vitest** (unitarios y de integración) y **Playwright** (e2e en
  móvil, con goldens visuales).

## Arquitectura

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
    antiguo (`docs/relleno-de-planes.md`).

### Curiosidades verificadas

Las curiosidades de cada parada son frases **literales** de Wikipedia y
Wikidata. El modelo solo elige, entre candidatas ya extraídas y saneadas,
cuáles mostrar; no redacta ninguna.

- Las reglas que deciden qué frase vale (saneado, cortes de frase,
  abreviaturas, siglas, edificio frente a institución) tienen una huella
  (`src/lib/guia/huella.ts`).
- `FORMATO_CURIOSIDADES` (`src/lib/guia/curiosidadesPlan.ts`, hoy **5**) es
  la versión de esas reglas. Si cambian las reglas sin subir el formato,
  falla el test de la huella.
- Al subir el formato, el trabajador rehace las curiosidades de la última
  versión de cada plan guardado (reproceso). `/api/salud` cuenta las que
  aún están en un formato antiguo.

### Salud del despliegue

`GET /api/salud` responde 200 si todo está en orden y 503 si no. Informa de:

- la conexión con Supabase y el esquema;
- cuándo se vio por última vez al trabajador, su commit y su último
  resultado;
- los secretos que faltan, y que no haya credenciales de modelo en la web;
- el estado del relleno, incluidas `curiosidades_formato_antiguo` y la pasada
  de alternativas.

Nunca devuelve texto crudo de errores. El cron diario de Vercel la llama a
las 07:00 UTC (`vercel.json`).

```
src/app/            páginas (criterios, plan, guía, mis viajes) y API (acceso, plan, trabajos, viajes, salud)
src/lib/plan/       modelo del plan, días y tramos entre paradas
src/lib/lugares/    resolución de lugares, ciudades y fotos con fuentes abiertas
src/lib/guia/       consejos y curiosidades de cada parada (reglas, huella y reproceso)
src/lib/alternativas/  alternativas de paradas y su equivalencia
src/lib/infografia/ lámina del plan
src/lib/cola/, src/lib/trabajador/  cola de trabajos y su procesado
src/lib/db/         cliente de Supabase atado al esquema del producto
supabase/migrations/  migraciones versionadas (solo aditivas)
docs/               fuentes de datos, guía de estilo, relleno de planes y viajes por país
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

Ninguna variable de modelo entra en el despliegue web.

## Cómo correr los tests

```bash
npm run lint
npm run typecheck
npm test                     # unitarios (Vitest)
npm run test:integration     # contra el Supabase de desarrollo
npm run test:e2e             # Playwright, móvil
npm run verificar:esqueleto  # build + arranque de producción + /api/salud + no-afiliación
```

## Changelog de cambios relevantes

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
