import globalSetup from "../src/verificacion/plan-prueba";

// Primer paso de una pasada de juicio: inicia sesión y encola (o reutiliza) el
// plan de prueba sin esperar al trabajador, para que la generación avance
// mientras se hacen las comprobaciones estáticas. La suite normal retoma
// después el sondeo desde plan.json.
process.env.VERIFICACION_SOLO_ENCOLAR = "1";
// Sin await de nivel superior: tsx compila este fichero como CommonJS.
globalSetup().catch((fallo: unknown) => {
  console.error(fallo instanceof Error ? fallo.message : "error desconocido");
  process.exitCode = 1;
});
