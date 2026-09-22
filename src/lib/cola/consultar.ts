import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CADUCIDAD_HORAS } from "./config";
import { porcentajeParaEtapa } from "./etapas";

export interface EstadoTrabajo {
  id: string;
  estado: string;
  etapa: string | null;
  porcentaje: number;
  motivo: string | null;
  creado_en: string;
  // vista-ac1: un trabajo pausado por cuota necesita su hora de reanudación
  // para explicarse, no solo el motivo.
  reintento_no_antes_de: string | null;
  // final-ac1: el trabajador ya escribe esta columna al completar
  // (procesarTrabajo.ts); faltaba pedirla aquí para que la pantalla de
  // progreso pudiera enlazar al plan. Nulo en cualquier estado que no sea
  // "completado", y también en un "completado" escrito antes de esta tanda.
  plan_id: string | null;
}

const MOTIVO_CADUCADO = "el trabajador no ha recogido el trabajo a tiempo";

// acceso-ac3: un trabajo que nadie toma caduca con motivo en vez de girar
// indefinidamente. Se comprueba en el momento de leer (no hay un cron
// aparte para esto): si sigue "encolado" pasada CADUCIDAD_HORAS desde su
// creación, se marca "caducado" aquí mismo antes de responder.
// borrar-ac1: un trabajo eliminado (marcado) deja de poder consultarse aquí
// -uno de los tres sitios que el borrado marcado obliga a filtrar, junto a
// listarViajes y planPerteneceAUsuario.
export async function obtenerTrabajo(
  supabase: SupabaseClient,
  id: string,
  usuarioId: string,
): Promise<EstadoTrabajo | null> {
  const { data, error } = await supabase
    .from("trabajos")
    .select("id, estado, etapa, motivo, creado_en, reintento_no_antes_de, plan_id")
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .is("eliminado_en", null)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el trabajo: ${error.message}`);
  if (!data) return null;

  if (data.estado === "encolado") {
    const creadoHaceMs = Date.now() - new Date(data.creado_en).getTime();
    if (creadoHaceMs > CADUCIDAD_HORAS * 3_600_000) {
      await supabase.from("trabajos").update({ estado: "caducado", motivo: MOTIVO_CADUCADO }).eq("id", id);
      return {
        id: data.id,
        estado: "caducado",
        etapa: data.etapa,
        porcentaje: porcentajeParaEtapa(data.etapa),
        motivo: MOTIVO_CADUCADO,
        creado_en: data.creado_en,
        reintento_no_antes_de: null,
        plan_id: null,
      };
    }
  }

  return {
    id: data.id,
    estado: data.estado,
    etapa: data.etapa,
    porcentaje: porcentajeParaEtapa(data.etapa),
    motivo: data.motivo,
    creado_en: data.creado_en,
    reintento_no_antes_de: data.reintento_no_antes_de,
    plan_id: data.plan_id,
  };
}
