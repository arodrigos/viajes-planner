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
import { aPlanPublico, type PlanPublico } from "../src/lib/plan/publico";
import { crearFuenteAbierta } from "../src/lib/lugares/fuenteAbierta";
import { resolverPlan } from "../src/lib/lugares/resolverPlan";
import { resolverCiudadEfectiva } from "../src/lib/lugares/ciudad";
import { crearFuenteFotosAbierta } from "../src/lib/lugares/fuenteFotosAbierta";
import { resolverFotosPlan } from "../src/lib/lugares/resolverFotos";
import { crearFuenteCercanosAbierta } from "../src/lib/alternativas/cercanos";
import { resolverAlternativasPlan } from "../src/lib/alternativas/resolverAlternativas";

function leerRutaCriterios(argv: string[]): string {
  const indice = argv.indexOf("--criterios-fichero");
  const ruta = indice !== -1 ? argv[indice + 1] : undefined;
  if (!ruta) throw new Error("uso: generar-plan-real --criterios-fichero <ruta> [--resolver]");
  return ruta;
}

// alt-ac1: --resolver recorre EXACTAMENTE el mismo camino que
// procesarTrabajo.ts tras el ensamblado -- resolverPlan, resolverFotosPlan
// y resolverAlternativasPlan contra las fuentes abiertas reales (nunca un
// doble) -- para que el Gatekeeper pueda comprobar de extremo a extremo
// que el modelo real + la resolución real producen el % de cobertura que
// el manifiesto exige. Sin la flag, el comportamiento es el de siempre
// (solo hasta postProcesarPlan): los demás bloques que usan este script
// sin --resolver no cambian.
function usaResolver(argv: string[]): boolean {
  return argv.includes("--resolver");
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

function algunaParadaConAlternativas(plan: Plan): boolean {
  return plan.dias.some((dia) => dia.paradas.some((parada) => (parada.alternativas ?? []).length > 0));
}

async function main() {
  const argv = process.argv.slice(2);
  const rutaCriterios = leerRutaCriterios(argv);
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

    // alt-ac1: misma regla de reintento único, ahora también para
    // alternativas -- dos invocaciones seguidas sin ninguna es un fallo
    // real del bloque alternativas-equivalentes, no mala suerte.
    if (!algunaParadaConAlternativas(resultado.plan)) {
      resultado = await generarUnPlan(criterios, directorio);
      if (!algunaParadaConAlternativas(resultado.plan)) {
        throw new Error("dos invocaciones seguidas sin ninguna alternativa: fallo del bloque, no mala suerte");
      }
    }

    let planParaSalida: Plan | PlanPublico = resultado.plan;
    if (usaResolver(argv)) {
      const fuenteLugares = crearFuenteAbierta();
      // ciu-ac5: EXACTAMENTE el mismo orden que procesarTrabajo.ts --
      // la ciudad efectiva se resuelve antes de las paradas, con el mismo
      // camino real (nunca un doble) que el trabajador de producción.
      const nombresParadas = resultado.plan.dias.flatMap((dia) => dia.paradas.map((parada) => parada.nombre));
      const ciudad = (await resolverCiudadEfectiva(fuenteLugares, resultado.plan.destino, nombresParadas)) ?? undefined;
      const planConCiudad: Plan = ciudad ? { ...resultado.plan, ciudad } : resultado.plan;
      const cualificadorCiudad = ciudad?.estado === "resuelta" && ciudad.nombre && ciudad.caja ? { nombre: ciudad.nombre, caja: ciudad.caja } : undefined;
      const conLugares = await resolverPlan(fuenteLugares, planConCiudad, cualificadorCiudad);
      const conFotos = await resolverFotosPlan(crearFuenteFotosAbierta(), conLugares);
      const conAlternativas = await resolverAlternativasPlan(fuenteLugares, crearFuenteCercanosAbierta(), conFotos, criterios.perfil, cualificadorCiudad);
      planParaSalida = aPlanPublico(conAlternativas);
    }

    process.stdout.write(`${JSON.stringify({ crudo: resultado.crudo, plan: planParaSalida })}\n`);
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
