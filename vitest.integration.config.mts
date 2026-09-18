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
    },
  },
});
