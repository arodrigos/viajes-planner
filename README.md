# viajes-planner

## Qué es esto

Planificador de viajes turísticos personal y familiar. Recibe criterios y
limitaciones (fechas, ciudades, ritmo, si se viaja con niños) y devuelve un
plan optimizado por días, con una guía interactiva en destino: mapa, paradas
con su consejo y sus curiosidades, tramos entre paradas, alternativas y
sitios marcados como visitados. También genera una infografía del plan.

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

```
src/app/            páginas (criterios, plan, guía, mis viajes) y API (acceso, plan, trabajos, viajes, salud)
src/lib/plan/       modelo del plan, días y tramos entre paradas
src/lib/lugares/    resolución de lugares, ciudades y fotos con fuentes abiertas
src/lib/guia/       consejos y curiosidades de cada parada
src/lib/alternativas/  alternativas de paradas y su equivalencia
src/lib/infografia/ lámina del plan
src/lib/cola/, src/lib/trabajador/  cola de trabajos y su procesado
src/lib/db/         cliente de Supabase atado al esquema del producto
supabase/migrations/  migraciones versionadas (solo aditivas)
docs/               fuentes de datos, relleno de planes y viajes por país
```

## Ramas y despliegue

- **`dev`** es la rama de trabajo y la rama por defecto. Los PRs van contra
  `dev`. Un push a `dev` pasa el CI, aplica las migraciones pendientes al
  Supabase de desarrollo y despliega la preview de Vercel, protegida con
  login.
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
