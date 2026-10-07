// alt-ac5/alt-ac6: cambiar una parada por una de sus alternativas, sin
// invocar al modelo ni a ninguna fuente externa. Lee la versión actual,
// copia la versión actual en la base con la parada sustituida (misma
// franja_id, mismo id externo -- las visitas y la identidad de la parada
// sobreviven) y la parada anterior pasa a ser una alternativa de la nueva
// (deshacer = volver a sustituir).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recuperarParadaActual, reemplazarParadaEnNuevaVersion } from "./repositorio";
import type { Alternativa, Parada } from "./tipos";

const MAXIMO_ALTERNATIVAS = 3;

// alc-ac1: la parada nueva conserva las alternativas no elegidas (en su
// orden) y la sustituida va siempre al final. El recorte se hace ANTES de
// añadirla: recortar después descartaba justo la sustituida cuando había 4 o
// más alternativas y el usuario ya no podía deshacer el cambio. Sin nombres
// repetidos, para no arrastrar los duplicados de versiones anteriores.
export function heredarAlternativas(actuales: Alternativa[], elegida: Alternativa, sustituida: Alternativa): Alternativa[] {
  const vistos = new Set<string>([sustituida.nombre.trim().toLowerCase()]);
  const conservadas = actuales.filter((alternativa) => {
    const clave = alternativa.nombre.trim().toLowerCase();
    if (alternativa === elegida || vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
  return [...conservadas.slice(0, MAXIMO_ALTERNATIVAS - 1), sustituida];
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
    motivo_parada: paradaActual.motivo,
    coste_parada: paradaActual.coste,
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
    // una razón y un coste que no corresponden al sitio nuevo. Solo los trae
    // una alternativa que fue parada (deshacer), con los suyos de entonces.
    motivo: alternativaElegida.motivo_parada,
    coste: alternativaElegida.coste_parada,
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
  const paradaActual = await recuperarParadaActual(supabase, planId, paradaId);
  if (!paradaActual) return { estado: "no-encontrado" };

  // alt-ac6: la alternativa tiene que pertenecer a ESTA parada de la
  // versión actual -- se identifica por su id de fila (paradas_alternativas.id,
  // recuperarParadaActual lo adjunta a cada Alternativa), nunca por su
  // posición ni por su nombre.
  const alternativaElegida = (paradaActual.alternativas ?? []).find((alternativa) => alternativa.id === alternativaId);
  if (!alternativaElegida) return { estado: "alternativa-invalida" };

  const { version } = await reemplazarParadaEnNuevaVersion(supabase, planId, intercambiar(paradaActual, alternativaElegida));
  return { estado: "sustituida", version };
}
