// reco-ac1: el script que el Gatekeeper ejecuta él mismo (manifiesto.
// verificacion_modelo_real, issue #171) para comprobar que el camino de
// producción de verdad genera un plan sin ninguna URL colada, invocando al
// modelo real -- nunca un doble, nunca esta etapa de desarrollo. Recorre
// EXACTAMENTE las mismas funciones que procesarTrabajo.ts usa en
// producción: construirPrompt, ejecutorClaudeCode, ensamblarYValidar,
// postProcesarPlan. Sin base de datos y sin ninguna variable de Supabase.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CriteriosViaje } from "../src/lib/criterios/tipos";
import { postProcesarPlan } from "../src/lib/generacion/postProcesar";
import { generarIdPlan } from "../src/lib/trabajador/id";
import { MODELO_GENERACION } from "../src/lib/trabajador/config";
import { LimiteDeUsoAlcanzado } from "../src/lib/trabajador/ejecutorModelo";
import { ejecutorClaudeCode } from "../src/lib/trabajador/ejecutorClaudeCode";
import { construirPrompt, construirPromptReintento } from "../src/lib/trabajador/prompt";
import { ensamblarYValidar } from "../src/lib/trabajador/procesarTrabajo";
import type { Plan } from "../src/lib/plan/tipos";

function leerRutaCriterios(argv: string[]): string {
  const indice = argv.indexOf("--criterios-fichero");
  const ruta = indice !== -1 ? argv[indice + 1] : undefined;
  if (!ruta) throw new Error("uso: generar-plan-real --criterios-fichero <ruta>");
  return ruta;
}

// Una invocación real, con el reintento que ya existe en producción cuando
// la respuesta no valida contra el esquema (mismo comportamiento que
// procesarTrabajo.ts, nunca uno nuevo inventado aquí).
async function generarUnPlan(criterios: CriteriosViaje, directorio: string): Promise<{ crudo: string; plan: Plan }> {
  const planId = generarIdPlan();
  const prompt = construirPrompt(criterios);

  const primeraRespuesta = await ejecutorClaudeCode.invocar(prompt, { directorio, modelo: MODELO_GENERACION });
  let intento = ensamblarYValidar(criterios, planId, primeraRespuesta.texto);
  let crudo = primeraRespuesta.texto;

  if (!intento.valido) {
    const promptReintento = construirPromptReintento(prompt, intento.errores);
    const segundaRespuesta = await ejecutorClaudeCode.invocar(promptReintento, { directorio, modelo: MODELO_GENERACION });
    crudo = segundaRespuesta.texto;
    intento = ensamblarYValidar(criterios, planId, segundaRespuesta.texto);
  }

  if (!intento.valido) {
    const motivo = intento.errores.map((e) => `${e.ruta}: ${e.mensaje}`).join("; ");
    throw new Error(`la respuesta del modelo no validó tras el reintento: ${motivo}`);
  }

  const { plan } = postProcesarPlan(intento.plan, criterios);
  return { crudo, plan };
}

async function main() {
  const rutaCriterios = leerRutaCriterios(process.argv.slice(2));
  const criterios = JSON.parse(readFileSync(rutaCriterios, "utf-8")) as CriteriosViaje;

  const directorio = mkdtempSync(join(tmpdir(), "viajes-verificacion-modelo-"));
  try {
    let resultado = await generarUnPlan(criterios, directorio);

    // manifiesto.verificacion_modelo_real: si el modelo no devuelve ninguna
    // recomendación en una invocación, se repite UNA vez -- dos invocaciones
    // seguidas sin recomendaciones es un fallo del bloque, no mala suerte.
    if ((resultado.plan.recomendaciones ?? []).length === 0) {
      resultado = await generarUnPlan(criterios, directorio);
      if ((resultado.plan.recomendaciones ?? []).length === 0) {
        throw new Error("dos invocaciones seguidas sin recomendaciones: fallo del bloque, no mala suerte");
      }
    }

    process.stdout.write(`${JSON.stringify({ crudo: resultado.crudo, plan: resultado.plan })}\n`);
  } finally {
    rmSync(directorio, { recursive: true, force: true });
  }
}

main().catch((error) => {
  if (error instanceof LimiteDeUsoAlcanzado) {
    console.error(`[generar-plan-real] límite de uso alcanzado: ${error.message}`);
  } else {
    console.error("[generar-plan-real] falló:", error);
  }
  process.exitCode = 1;
});
