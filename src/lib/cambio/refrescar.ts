import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsearXmlBCE } from "./bce";

export const URL_BCE_DIARIO = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export interface ResultadoRefrescoCambio {
  ok: boolean;
  fecha_referencia?: string;
  error?: string;
}

// latido-ac3: si el BCE no responde (red caída, 503...) esta función nunca
// lanza y nunca borra ni toca las filas ya guardadas — con solo no
// insertar filas nuevas, "conservar el último tipo con su fecha" es gratis.
export async function refrescarTiposCambio(
  supabase: SupabaseClient,
  fetchImpl: typeof fetch = fetch,
): Promise<ResultadoRefrescoCambio> {
  try {
    const respuesta = await fetchImpl(URL_BCE_DIARIO);
    if (!respuesta.ok) {
      return { ok: false, error: `El BCE respondió ${respuesta.status}` };
    }

    const xml = await respuesta.text();
    const { fecha_referencia, tasas } = parsearXmlBCE(xml);
    const filas = Object.entries(tasas).map(([moneda, tasa_eur]) => ({
      moneda,
      fecha_referencia,
      tasa_eur,
    }));

    const { error } = await supabase.from("tipos_cambio").upsert(filas, { onConflict: "moneda,fecha_referencia" });
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, fecha_referencia };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
