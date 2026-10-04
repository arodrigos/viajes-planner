// alt-ac5/alt-ac6: cambiar una parada por una de sus alternativas, sin
// invocar al modelo ni a ninguna fuente externa. Lee la versión actual,
// construye la siguiente con la parada sustituida (misma franja_id, mismo
// id externo -- las visitas y la identidad de la parada sobreviven) y la
// parada anterior pasa a ser la única alternativa de la nueva (deshacer =
// volver a sustituir). guardarPlan asigna la versión siguiente.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { guardarPlan, recuperarPlan } from "./repositorio";
import type { Alternativa } from "./tipos";

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
  };

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
    alternativas: [paradaAnteriorComoAlternativa],
  };

  const diasNuevos = plan.dias.map((dia, iDia) => {
    if (iDia !== diaIndexEncontrado) return dia;
    const paradasNuevas = dia.paradas.map((parada, iParada) => (iParada === paradaIndexEncontrado ? paradaNueva : parada));
    return { ...dia, paradas: paradasNuevas };
  });

  const { version } = await guardarPlan(supabase, { ...plan, dias: diasNuevos });
  return { estado: "sustituida", version };
}
