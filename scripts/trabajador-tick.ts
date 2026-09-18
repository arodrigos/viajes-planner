// Entrypoint del cron de VPS1 (cada dos minutos, manifiesto.cron). NO se
// ejecuta desde este agente de desarrollo: instalarlo es un paso de
// traspaso que hace mantenimiento sobre la flota viva, fuera del terreno
// de esta etapa (CLAUDE.md, regla 8). Vive en su propio directorio de
// trabajo, efímero por trabajo, y usa la sesión de Claude Code de Adrián
// vía el binario `claude` del PATH heredado, nunca una clave de API.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { ejecutorClaudeCode } from "../src/lib/trabajador/ejecutorClaudeCode";
import { tick } from "../src/lib/trabajador/tick";

async function main() {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno del trabajador");
  }
  const supabase = createClient(url, clave, { auth: { persistSession: false } });

  const directorio = mkdtempSync(join(tmpdir(), "viajes-trabajo-"));
  try {
    const resultado = await tick(supabase, { ejecutor: ejecutorClaudeCode, directorio });
    console.log(`[trabajador] cerrojo=${resultado.cerrojoAdquirido} procesados=${resultado.trabajosProcesados}`);
  } finally {
    rmSync(directorio, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("[trabajador] tick falló:", error);
  process.exitCode = 1;
});
