import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { validarPlan, type ErrorValidacion } from "@/lib/plan/validar";
import { guardarPlan } from "@/lib/plan/repositorio";
import type { Plan } from "@/lib/plan/tipos";
import type { EjecutorModelo } from "./ejecutorModelo";
import { construirPrompt, construirPromptReintento } from "./prompt";
import { generarIdPlan } from "./id";
import { MODELO_GENERACION } from "./config";

export interface TrabajoAProcesar {
  id: string;
  plan_id: string | null;
  criterios: CriteriosViaje;
}

interface DependenciasProcesarTrabajo {
  ejecutor: EjecutorModelo;
  directorio: string;
}

type IntentoEnsamblado = { valido: true; plan: Plan } | { valido: false; errores: ErrorValidacion[] };

// trabajador-ac2: el modelo solo aporta "dias" (y lo que contengan); id,
// version, destino y personas los fija el proceso, nunca el modelo — el
// modelo nunca decide la identidad del plan, solo su contenido.
function ensamblarYValidar(criterios: CriteriosViaje, planId: string, texto: string): IntentoEnsamblado {
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    return { valido: false, errores: [{ ruta: "(raíz)", mensaje: "la respuesta del modelo no es JSON válido" }] };
  }

  const dias = (datos as { dias?: unknown }).dias;
  const candidato: Plan = {
    id: planId,
    version: 1,
    destino: criterios.destino_o_tipo,
    personas: criterios.personas.length,
    dias: (dias as Plan["dias"]) ?? [],
  };

  const resultado = validarPlan(candidato);
  return resultado.valido ? { valido: true, plan: candidato } : { valido: false, errores: resultado.errores };
}

async function publicarEtapa(supabase: SupabaseClient, trabajoId: string, etapa: string): Promise<void> {
  await supabase.from("trabajos").update({ etapa, actualizado_en: new Date().toISOString() }).eq("id", trabajoId);
}

// trabajador-ac1 (no en CI, ver ejecutorModelo.ts) / trabajador-ac2: un
// trabajo se completa de extremo a extremo o queda 'fallido' con motivo;
// nunca hay una escritura a medias en planes.
export async function procesarTrabajo(
  supabase: SupabaseClient,
  trabajo: TrabajoAProcesar,
  { ejecutor, directorio }: DependenciasProcesarTrabajo,
): Promise<{ estado: "completado" | "fallido" }> {
  await publicarEtapa(supabase, trabajo.id, "preparando la petición");
  const planId = trabajo.plan_id ?? generarIdPlan();

  await publicarEtapa(supabase, trabajo.id, "generando el plan");
  const prompt = construirPrompt(trabajo.criterios);
  const primeraRespuesta = await ejecutor.invocar(prompt, { directorio, modelo: MODELO_GENERACION });
  let intento = ensamblarYValidar(trabajo.criterios, planId, primeraRespuesta.texto);

  if (!intento.valido) {
    const promptReintento = construirPromptReintento(prompt, intento.errores);
    const segundaRespuesta = await ejecutor.invocar(promptReintento, { directorio, modelo: MODELO_GENERACION });
    intento = ensamblarYValidar(trabajo.criterios, planId, segundaRespuesta.texto);
  }

  if (!intento.valido) {
    const motivo = intento.errores.map((e) => `${e.ruta}: ${e.mensaje}`).join("; ");
    await supabase
      .from("trabajos")
      .update({ estado: "fallido", motivo, actualizado_en: new Date().toISOString() })
      .eq("id", trabajo.id);
    return { estado: "fallido" };
  }

  await publicarEtapa(supabase, trabajo.id, "guardando");
  await guardarPlan(supabase, intento.plan);
  await supabase
    .from("trabajos")
    .update({ estado: "completado", plan_id: planId, etapa: "guardando", actualizado_en: new Date().toISOString() })
    .eq("id", trabajo.id);
  return { estado: "completado" };
}
