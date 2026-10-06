// alt-ac5/alt-ac6: cambiar una parada por una de sus alternativas, sin
// invocar al modelo ni a ninguna fuente externa. Lee la versión actual,
// construye la siguiente con la parada sustituida (misma franja_id, mismo
// id externo -- las visitas y la identidad de la parada sobreviven) y la
// parada anterior pasa a ser la única alternativa de la nueva (deshacer =
// volver a sustituir). guardarPlan asigna la versión siguiente.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { guardarPlan, recuperarPlan } from "./repositorio";
import type { Alternativa, Parada } from "./tipos";

const MAXIMO_ALTERNATIVAS = 3;

// alc-ac1: la parada nueva conserva las alternativas no elegidas (en su
// orden) y la sustituida va al final; el tope es el mismo de siempre, así
// que con 3 alternativas se recorta la última, nunca se llega a 4.
export function heredarAlternativas(actuales: Alternativa[], elegida: Alternativa, sustituida: Alternativa): Alternativa[] {
  return [...actuales.filter((alternativa) => alternativa !== elegida), sustituida].slice(0, MAXIMO_ALTERNATIVAS);
}

// Pura y exportada para poder probar las invariantes de la herencia con
// cualquier parada y alternativa: la guía del sitio nuevo es la de su
// alternativa, la del anterior viaja a su alternativa, y motivo y coste (del
// hueco, no del sitio) no se heredan.
export function intercambiar(paradaActual: Parada, alternativaElegida: Alternativa): Parada {
  const paradaAnteriorComoAlternativa: Alternativa = {
    nombre: paradaActual.nombre,
    descripcion: paradaActual.descripcion,
    motivo: "Era la actividad anterior en este hueco.",
    duracion_min: paradaActual.duracion_min,
    categoria: paradaActual.categoria,
    origen: "modelo",
    coordenadas: paradaActual.coordenadas,
    lugar: paradaActual.lugar,
    foto: paradaActual.foto,
    // La guía viaja con el sitio: al deshacer, la parada original recupera la
    // suya sin volver a pedirla a ninguna fuente.
    guia: paradaActual.guia,
    curiosidades: paradaActual.curiosidades,
    guia_intentada_en: paradaActual.guia_intentada_en,
    guia_formato: paradaActual.guia_formato,
  };

  const alternativasHeredadas = heredarAlternativas(paradaActual.alternativas ?? [], alternativaElegida, paradaAnteriorComoAlternativa);

  const paradaNueva = {
    ...paradaActual,
    nombre: alternativaElegida.nombre,
    descripcion: alternativaElegida.descripcion,
    duracion_min: alternativaElegida.duracion_min,
    categoria: alternativaElegida.categoria,
    coordenadas: alternativaElegida.coordenadas,
    lugar: alternativaElegida.lugar,
    foto: alternativaElegida.foto,
    resolucion: alternativaElegida.coordenadas ? { estado: "resuelta" as const, intentado_en: new Date().toISOString() } : undefined,
    alternativas: alternativasHeredadas,
    // El motivo y el precio eran del sitio anterior: heredarlos presentaría
    // una razón y un coste que no corresponden al sitio nuevo.
    motivo: undefined,
    coste: undefined,
    // La guía sí es del sitio nuevo: la trae su alternativa. Si aún no la
    // tenía (guia_intentada_en ausente), la parada queda pendiente y el
    // barrido la rellena.
    guia: alternativaElegida.guia,
    curiosidades: alternativaElegida.curiosidades,
    guia_intentada_en: alternativaElegida.guia_intentada_en,
    guia_formato: alternativaElegida.guia_formato,
  };

  return paradaNueva;
}

export type ResultadoSustitucion =
  | { estado: "sustituida"; version: number }
  | { estado: "no-encontrado" }
  | { estado: "alternativa-invalida" };

export async function sustituirParada(
  supabase: SupabaseClient,
  planId: string,
  paradaId: string,
  alternativaId: string,
): Promise<ResultadoSustitucion> {
  const plan = await recuperarPlan(supabase, planId);
  if (!plan) return { estado: "no-encontrado" };

  let diaIndexEncontrado = -1;
  let paradaIndexEncontrado = -1;
  plan.dias.forEach((dia, iDia) => {
    const iParada = dia.paradas.findIndex((p) => p.id === paradaId);
    if (iParada !== -1) {
      diaIndexEncontrado = iDia;
      paradaIndexEncontrado = iParada;
    }
  });
  if (diaIndexEncontrado === -1) return { estado: "no-encontrado" };

  const paradaActual = plan.dias[diaIndexEncontrado].paradas[paradaIndexEncontrado];

  // alt-ac6: la alternativa tiene que pertenecer a ESTA parada de la
  // versión actual -- se identifica por su id de fila (paradas_alternativas.id,
  // recuperarPlan lo adjunta a cada Alternativa), nunca por su posición ni
  // por su nombre.
  const alternativaElegida = (paradaActual.alternativas ?? []).find((alternativa) => alternativa.id === alternativaId);
  if (!alternativaElegida) return { estado: "alternativa-invalida" };

  const paradaNueva = intercambiar(paradaActual, alternativaElegida);

  const diasNuevos = plan.dias.map((dia, iDia) => {
    if (iDia !== diaIndexEncontrado) return dia;
    const paradasNuevas = dia.paradas.map((parada, iParada) => (iParada === paradaIndexEncontrado ? paradaNueva : parada));
    return { ...dia, paradas: paradasNuevas };
  });

  const { version } = await guardarPlan(supabase, { ...plan, dias: diasNuevos });
  return { estado: "sustituida", version };
}
