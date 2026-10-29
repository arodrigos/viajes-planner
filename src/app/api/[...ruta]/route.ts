import { exportarMetodos, type Tabla } from "@/lib/api/despachar";

// Rutas de API fuera de /api/plan agrupadas en una sola función de Vercel
// (/api/plan y /api/plan/[id] siguen siendo route.ts propios).
const tabla: Tabla = [
  { patron: "/api/acceso/solicitar-codigo", modulo: () => import("../acceso/solicitar-codigo/manejador") },
  { patron: "/api/acceso/verificar-codigo", modulo: () => import("../acceso/verificar-codigo/manejador") },
  { patron: "/api/auth/cerrar-sesion", modulo: () => import("../auth/cerrar-sesion/manejador") },
  { patron: "/api/google/ficha", modulo: () => import("../google/ficha/manejador") },
  { patron: "/api/salud", modulo: () => import("../salud/manejador") },
  { patron: "/api/trabajos/[id]", modulo: () => import("../trabajos/[id]/manejador") },
  { patron: "/api/viajes", modulo: () => import("../viajes/manejador") },
  { patron: "/api/viajes/[id]", modulo: () => import("../viajes/[id]/manejador") },
];

export const { GET, POST, PATCH, PUT, DELETE } = exportarMetodos(tabla);
