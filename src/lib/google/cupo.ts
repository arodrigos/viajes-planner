import type { SupabaseClient } from "@supabase/supabase-js";

// Los SKU de Google que el producto usa; cada uno tiene su fila en
// topes_google. GetPlace y GetPhotoMedia no están: no se usan y su cuota de
// consola es 0.
export type SkuGoogle = "text_search_pro" | "ui_kit";

export type MotivoDenegado = "tope-dia" | "tope-mes" | "tope-usuario" | "error-reserva";

export type ResultadoConCupo<T> = { concedido: true; valor: T } | { concedido: false; motivo: MotivoDenegado };

const MOTIVOS_DE_LA_FUNCION: ReadonlySet<string> = new Set(["tope-dia", "tope-mes", "tope-usuario"]);

// La reserva va ANTES de la petición y no se devuelve si Google falla: un
// reintento en bucle contra una API caída gastaría cupo igual que una
// petición buena, y devolverlo permitiría justo ese bucle. Cerrado ante el
// fallo: si la rpc no responde o devuelve algo inesperado, no sale ninguna
// petición, porque sin contador no hay forma de saber cuánto queda.
export async function conCupo<T>(
  supabase: SupabaseClient,
  sku: SkuGoogle,
  usuario: string | null,
  llamada: () => Promise<T>,
): Promise<ResultadoConCupo<T>> {
  let respuesta: unknown;
  try {
    const { data, error } = await supabase.rpc("reservar_cupo_google", { p_sku: sku, p_usuario: usuario });
    if (error) return { concedido: false, motivo: "error-reserva" };
    respuesta = data;
  } catch {
    return { concedido: false, motivo: "error-reserva" };
  }
  if (respuesta === "ok") {
    return { concedido: true, valor: await llamada() };
  }
  if (typeof respuesta === "string" && MOTIVOS_DE_LA_FUNCION.has(respuesta)) {
    return { concedido: false, motivo: respuesta as MotivoDenegado };
  }
  return { concedido: false, motivo: "error-reserva" };
}
