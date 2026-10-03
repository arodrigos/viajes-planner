# viajes-planner

Planificador/optimizador de viajes turísticos personal y familiar: criterios
y limitaciones de entrada, plan optimizado, y guía interactiva en destino con
mapa y sitios marcados como visitados.

Producto personal, sin monetización. Ver `CLAUDE.md` para las condiciones
que esa decisión impone al repo.

## Ramas

- **`dev`** es la rama de trabajo y la rama por defecto del repo: los PRs van contra `dev`. Un push a `dev` despliega una preview en Vercel y pasa el CI.
- **`main` es producción.** El paso de `dev` a `main` solo lo decide Adrián, de forma explícita y para cada caso. Nadie, ni personas ni agentes, mergea a `main` por su cuenta, aunque el cambio sea solo de CI o de documentación.
- El trabajador (cron cada 5 min) corre sobre la cabeza de `dev` y se actualiza solo antes de cada tick.

## Desarrollo local

```bash
npm install
npm run dev
```

Copia `.env.example` a `.env.local` con las credenciales del proyecto
Supabase compartido de la flota (`VPSClaudeCodeProject-DEV` en local/CI,
`-PROD` en producción -nunca un proyecto propio de este producto) y
`SUPABASE_SCHEMA=viajes_planner`, el esquema de este producto dentro de ese
proyecto compartido.

## Verificación

```bash
npm run lint
npm run typecheck
npm test
npm run verificar:esqueleto   # build + arranque de producción + /api/salud + no-afiliación
```
