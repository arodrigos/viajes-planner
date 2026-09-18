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
}

const MOTIVO_CADUCADO = "el trabajador no ha recogido el trabajo a tiempo";

// cola-ac3: un trabajo que nadie toma caduca con motivo en vez de girar
// indefinidamente. Se comprueba en el momento de leer (no hay un cron
// aparte para esto): si sigue "encolado" pasada CADUCIDAD_HORAS desde su
// creación, se marca "caducado" aquí mismo antes de responder.
export async function obtenerTrabajo(
  supabase: SupabaseClient,
  id: string,
  usuarioId: string,
): Promise<EstadoTrabajo | null> {
  const { data, error } = await supabase
    .from("trabajos")
    .select("id, estado, etapa, motivo, creado_en")
    .eq("id", id)
    .eq("usuario_id", usuarioId)
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
  };
}
