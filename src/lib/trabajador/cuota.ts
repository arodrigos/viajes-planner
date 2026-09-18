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

export interface EstadoCuota {
  superaUmbral: boolean;
  resetsAt: string | null;
}

// Lee la última lectura conocida en uso_suscripcion para la ventana
// semanal (seven_day) de la familia dada. Fail-open si no hay ninguna
// fila todavía: quien escribe esta tabla es la propia invocación del
// modelo, al observar su respuesta (ver registrarLecturaCuota, usado
// desde procesarTrabajo.ts) — el primer trabajo de la vida del trabajador
// no tiene de dónde leer un estado previo, y bloquearlo sin ninguna señal
// real sería peor que dejarlo arrancar.
export async function estadoCuota(
  supabase: SupabaseClient,
  familia: FamiliaModelo,
  umbral: number,
): Promise<EstadoCuota> {
  const { data, error } = await supabase
    .from("uso_suscripcion")
    .select("used_percentage, resets_at")
    .eq("familia", familia)
    .eq("ventana", "seven_day")
    .order("leido_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`No se pudo leer el estado de cuota: ${error.message}`);
  if (!data) return { superaUmbral: false, resetsAt: null };

  return { superaUmbral: data.used_percentage >= umbral, resetsAt: data.resets_at };
}

// Registra una lectura de uso observada (al completar una invocación o al
// toparse con su límite) para que la próxima comprobación, en el
// siguiente trabajo, tenga con qué decidir.
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
