import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { postProcesarPlan } from "@/lib/generacion/postProcesar";
import { validarPlan, type ErrorValidacion } from "@/lib/plan/validar";
import { guardarPlan } from "@/lib/plan/repositorio";
import type { Plan } from "@/lib/plan/tipos";
import { familiaDeModelo, registrarLecturaCuota } from "./cuota";
import { LimiteDeUsoAlcanzado, type EjecutorModelo, type ResultadoInvocacion } from "./ejecutorModelo";
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

// trabajador-ac1 (real, 2026-09-21): el prompt (prompt.ts) ya pide
// "ÚNICAMENTE un objeto JSON, sin texto fuera del JSON" -- eso es una
// PREFERENCIA, no una garantía. La primera vez que este código invocó al
// modelo de verdad, envolvió la respuesta en una valla de markdown
// (```json ... ```) pese a la instrucción explícita, dos veces seguidas
// (intento y reintento). La red real contra ese comportamiento conocido de
// los modelos es esta extracción, no el texto del prompt.
function extraerJson(texto: string): string {
  const conValla = texto.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (conValla) return conValla[1];
  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio !== -1 && fin > inicio) return texto.slice(inicio, fin + 1);
  return texto;
}

// trabajador-ac2: el modelo solo aporta "dias" (y lo que contengan); id,
// version, destino y personas los fija el proceso, nunca el modelo — el
// modelo nunca decide la identidad del plan, solo su contenido.
function ensamblarYValidar(criterios: CriteriosViaje, planId: string, texto: string): IntentoEnsamblado {
  let datos: unknown;
  try {
    datos = JSON.parse(extraerJson(texto));
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

async function pausarPorCuota(
  supabase: SupabaseClient,
  trabajoId: string,
  motivo: string,
  reintentoNoAntesDe: string | null,
): Promise<void> {
  await supabase
    .from("trabajos")
    .update({
      estado: "pausado-por-cuota",
      motivo,
      reintento_no_antes_de: reintentoNoAntesDe,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", trabajoId);
}

type RespuestaOLimitada = ResultadoInvocacion | { limitado: true };

// trabajador-ac4 (b): un límite de uso a media invocación no debe crashear
// ni perder el trabajo — queda pausado con el motivo real del modelo y su
// hora de reinicio exacta. trabajador-ac5: la lectura solo se registra
// cuando el ejecutor de verdad sabe el porcentaje consumido (nunca hoy, en
// modo headless); si usedPercentage es null no se escribe ninguna fila
// inventada en uso_suscripcion.
async function invocarOPausar(
  supabase: SupabaseClient,
  trabajoId: string,
  familia: ReturnType<typeof familiaDeModelo>,
  ejecutor: EjecutorModelo,
  prompt: string,
  directorio: string,
): Promise<RespuestaOLimitada> {
  try {
    return await ejecutor.invocar(prompt, { directorio, modelo: MODELO_GENERACION });
  } catch (error) {
    if (!(error instanceof LimiteDeUsoAlcanzado)) throw error;
    if (error.usedPercentage !== null) {
      await registrarLecturaCuota(supabase, familia, error.usedPercentage, error.resetsAt);
    }
    await pausarPorCuota(supabase, trabajoId, error.message, error.resetsAt);
    return { limitado: true };
  }
}

// trabajador-ac1 (no en CI, ver ejecutorModelo.ts) / trabajador-ac2: un
// trabajo se completa de extremo a extremo o queda 'fallido' con motivo;
// nunca hay una escritura a medias en planes. trabajador-ac4: ya no hay
// pre-chequeo — con la cola no vacía el trabajador invoca siempre; el
// único mecanismo de cuota es la pausa reactiva de invocarOPausar.
export async function procesarTrabajo(
  supabase: SupabaseClient,
  trabajo: TrabajoAProcesar,
  { ejecutor, directorio }: DependenciasProcesarTrabajo,
): Promise<{ estado: "completado" | "fallido" | "pausado-por-cuota" }> {
  const familia = familiaDeModelo(MODELO_GENERACION);

  await publicarEtapa(supabase, trabajo.id, "preparando la petición");
  const planId = trabajo.plan_id ?? generarIdPlan();

  await publicarEtapa(supabase, trabajo.id, "generando el plan");
  const prompt = construirPrompt(trabajo.criterios);
  const primeraRespuesta = await invocarOPausar(supabase, trabajo.id, familia, ejecutor, prompt, directorio);
  if ("limitado" in primeraRespuesta) return { estado: "pausado-por-cuota" };
  let intento = ensamblarYValidar(trabajo.criterios, planId, primeraRespuesta.texto);

  if (!intento.valido) {
    const promptReintento = construirPromptReintento(prompt, intento.errores);
    const segundaRespuesta = await invocarOPausar(supabase, trabajo.id, familia, ejecutor, promptReintento, directorio);
    if ("limitado" in segundaRespuesta) return { estado: "pausado-por-cuota" };
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
  // generacion-ac1/ac2: red de seguridad determinista sobre el plan ya
  // validado estructuralmente, no una confianza ciega en que el modelo
  // obedeció el tope y la exclusión de categorías pedidos en el prompt.
  const { plan: planFinal } = postProcesarPlan(intento.plan, trabajo.criterios);
  await guardarPlan(supabase, planFinal);
  await supabase
    .from("trabajos")
    .update({ estado: "completado", plan_id: planId, etapa: "guardando", actualizado_en: new Date().toISOString() })
    .eq("id", trabajo.id);
  return { estado: "completado" };
}
