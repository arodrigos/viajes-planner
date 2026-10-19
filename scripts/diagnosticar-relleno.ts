// Diagnóstico de solo lectura del relleno de planes: recuentos agregados de la
// última versión de cada plan, sin destinos, nombres ni ids. La URL de la base
// se pasa por DIAGNOSTICO_DB_URL (el rol de solo lectura) y nunca se escribe en
// el repo. Las cifras leídas con él están en docs/relleno-de-planes.md
// (sección «Diagnóstico del relleno a cero»). Uso: DIAGNOSTICO_DB_URL=... npx tsx scripts/diagnosticar-relleno.ts
import { execFileSync } from "node:child_process";
import { CONSULTA_DIAGNOSTICO, construirResumen, extraerJson } from "../src/lib/trabajador/diagnosticoRelleno";

const url = process.env.DIAGNOSTICO_DB_URL;
if (!url) {
  console.error("Falta DIAGNOSTICO_DB_URL (URL de solo lectura de la base).");
  process.exit(2);
}

// La URL va por variable de entorno de psql y no por argumento, para que no
// aparezca en la lista de procesos.
const salida = execFileSync("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"], {
  input: CONSULTA_DIAGNOSTICO,
  encoding: "utf8",
  env: { ...process.env, PGCONNECT_TIMEOUT: "10", PSQLRC: "/dev/null", DATABASE_URL: undefined, PGSERVICEFILE: undefined },
  timeout: 60_000,
});
console.log(JSON.stringify(construirResumen(extraerJson(salida)), null, 2));
