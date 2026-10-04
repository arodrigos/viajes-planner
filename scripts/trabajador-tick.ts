// Entrypoint del cron de VPS1 (cada dos minutos, manifiesto.cron). NO se
// ejecuta desde este agente de desarrollo: instalarlo es un paso de
// traspaso que hace mantenimiento sobre la flota viva, fuera del terreno
// de esta etapa (CLAUDE.md, regla 8). Vive en su propio directorio de
// trabajo, efímero por trabajo, y usa la sesión de Claude Code de Adrián
// vía el binario `claude` del PATH heredado, nunca una clave de API.
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clienteServicio } from "../src/lib/db/cliente";
import { ejecutorClaudeCode } from "../src/lib/trabajador/ejecutorClaudeCode";
import { tick } from "../src/lib/trabajador/tick";

// bar-ac4: el SHA que de verdad corre aquí, no el que Vercel informa --
// git pull --ff-only (el propio wrapper del cron) ya deja el checkout en
// el commit correcto antes de llegar a este script.
function commitShaActual(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: __dirname, encoding: "utf8" }).trim();
  } catch {
    return "desconocido";
  }
}

async function main() {
  const supabase = clienteServicio();
  const commitSha = commitShaActual();

  const directorio = mkdtempSync(join(tmpdir(), "viajes-trabajo-"));
  try {
    const resultado = await tick(supabase, { ejecutor: ejecutorClaudeCode, directorio, commitSha });
    console.log(`[trabajador] cerrojo=${resultado.cerrojoAdquirido} procesados=${resultado.trabajosProcesados} sha=${commitSha}`);
  } finally {
    rmSync(directorio, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("[trabajador] tick falló:", error);
  process.exitCode = 1;
});
