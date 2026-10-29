import { exportarMetodos, type Tabla } from "@/lib/api/despachar";

// Rutas de un plan agrupadas en una sola función de Vercel. El plan, el plan
// bajo /api/plan/[id] y la infografía (que necesita sus fuentes) siguen siendo
// route.ts propios.
const base = "/api/plan/[id]";
const tabla: Tabla = [
  { patron: `${base}/calendario.ics`, modulo: () => import("../calendario.ics/manejador") },
  { patron: `${base}/ciudad`, modulo: () => import("../ciudad/manejador") },
  { patron: `${base}/gastos`, modulo: () => import("../gastos/manejador") },
  { patron: `${base}/gastos/[gastoId]`, modulo: () => import("../gastos/[gastoId]/manejador") },
  { patron: `${base}/miembros`, modulo: () => import("../miembros/manejador") },
  { patron: `${base}/miembros/[miembroId]`, modulo: () => import("../miembros/[miembroId]/manejador") },
  { patron: `${base}/orden`, modulo: () => import("../orden/manejador") },
  { patron: `${base}/paradas/[paradaId]/mover-dia`, modulo: () => import("../paradas/[paradaId]/mover-dia/manejador") },
  { patron: `${base}/paradas/[paradaId]/sustituir`, modulo: () => import("../paradas/[paradaId]/sustituir/manejador") },
  { patron: `${base}/regenerar`, modulo: () => import("../regenerar/manejador") },
  { patron: `${base}/reservas`, modulo: () => import("../reservas/manejador") },
  { patron: `${base}/reservas/[reservaId]`, modulo: () => import("../reservas/[reservaId]/manejador") },
  { patron: `${base}/sitios`, modulo: () => import("../sitios/manejador") },
  { patron: `${base}/sitios/[idExterno]`, modulo: () => import("../sitios/[idExterno]/manejador") },
  { patron: `${base}/visitas`, modulo: () => import("../visitas/manejador") },
];

export const { GET, POST, PATCH, PUT, DELETE } = exportarMetodos(tabla);
