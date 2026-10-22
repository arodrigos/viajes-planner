import globalSetup from "../plan-prueba";

// Lo lanza sin-credenciales.test.ts en un proceso aparte para ver exactamente
// lo que el global setup deja en stdout y stderr.
globalSetup().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : "fallo");
});
