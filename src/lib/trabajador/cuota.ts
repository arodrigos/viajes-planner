import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type FamiliaModelo = "opus" | "sonnet";

// trabajador-ac4: el pipeline horizontal completo consume la cuota de
// Opus; el trabajador genera con Sonnet a propósito (MODELO_GENERACION)
// para no competir por la misma ventana. La familia se deriva del nombre
// del modelo en vez de fijarse a mano para no desdoblar esta función si el
// modelo por defecto cambia.
export function familiaDeModelo(modelo: string): FamiliaModelo {
  return modelo.toLowerCase().includes("opus") ? "opus" : "sonnet";
}

// trabajador-ac4: se retira el freno preventivo y la función que lo leía
// por decisión de producto — decidía con un porcentaje que el modo headless
// no publica, así que su condición de umbral nunca reflejaba una medición
// real. Queda anotado como fase pendiente F2-15 en el manifiesto,
// condicionada a que exista una fuente fiable del dato; no se reconstruye
// aquí. El único estado que retiene un trabajo es ahora su propio
// reintento_no_antes_de, que tomar_siguiente_trabajo ya compara con now()
// en SQL.

// Registra una lectura de uso observada al toparse con un límite, para que
// quede constancia del motivo real. trabajador-ac5: solo se llama con un
// porcentaje real (ver invocarOPausar en procesarTrabajo.ts); el modo
// headless no lo publica hoy, así que en la práctica no se llama nunca —
// la tabla sigue existiendo, con su RLS, esperando a F2-15.
export async function registrarLecturaCuota(
  supabase: SupabaseClient,
  familia: FamiliaModelo,
  usedPercentage: number,
  resetsAt: string,
  ventana: "five_hour" | "seven_day" = "seven_day",
): Promise<void> {
  const { error } = await supabase
    .from("uso_suscripcion")
    .insert({ familia, ventana, used_percentage: usedPercentage, resets_at: resetsAt });
  if (error) throw new Error(`No se pudo registrar la lectura de cuota: ${error.message}`);
}
