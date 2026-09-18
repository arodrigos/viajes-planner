import { defineConfig } from "vitest/config";
import path from "node:path";

// Tests que necesitan la pila local de Supabase real (supabase start), no
// una base de datos simulada: RLS es una propiedad de Postgres y solo se
// comprueba de verdad contra un Postgres con las políticas aplicadas.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // "server-only" solo distingue Server/Client Components bajo el
      // bundler de Next.js (condición de exports "react-server"); fuera de
      // ahí (aquí, bajo Vite/Vitest) su índice por defecto siempre lanza.
      // El repositorio SÍ debe seguir siendo server-only en el build real.
      "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
    },
  },
});
