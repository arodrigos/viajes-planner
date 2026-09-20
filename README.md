# viajes-planner

Planificador/optimizador de viajes turísticos personal y familiar: criterios
y limitaciones de entrada, plan optimizado, y guía interactiva en destino con
mapa y sitios marcados como visitados.

Producto personal, sin monetización. Ver `CLAUDE.md` para las condiciones
que esa decisión impone al repo.

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
