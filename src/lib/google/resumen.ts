import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstadoGoogle } from "@/lib/salud";

const CLAVES_CONSUMO = ["text_search_hoy", "text_search_mes", "ui_kit_hoy", "ui_kit_mes"] as const;

// /api/salud es público: lo que devuelve la función solo se publica si tiene
// exactamente las cuatro claves y son enteros no negativos.
function validar(valor: unknown): Pick<EstadoGoogle, (typeof CLAVES_CONSUMO)[number]> {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    throw new Error("consumo_google_resumen() no devolvió un objeto");
  }
  const registro = valor as Record<string, unknown>;
  if (Object.keys(registro).length !== CLAVES_CONSUMO.length) {
    throw new Error("consumo_google_resumen() no devolvió exactamente las claves esperadas");
  }
  const salida = {} as Record<(typeof CLAVES_CONSUMO)[number], number>;
  for (const clave of CLAVES_CONSUMO) {
    const numero = registro[clave];
    if (typeof numero !== "number" || !Number.isInteger(numero) || numero < 0) {
      throw new Error(`consumo_google_resumen(): ${clave} no es un entero no negativo`);
    }
    salida[clave] = numero;
  }
  return salida;
}

export interface ClavesPresentes {
  trabajador: boolean;
  navegador: boolean;
}

async function contarLugares(supabase: SupabaseClient, estado: "casado" | "sin-coincidencia"): Promise<number> {
  const { count, error } = await supabase.from("lugares_google").select("clave", { count: "exact", head: true }).eq("estado", estado);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function leerEstadoGoogle(supabase: SupabaseClient, claves: ClavesPresentes): Promise<EstadoGoogle> {
  const { data, error } = await supabase.rpc("consumo_google_resumen");
  if (error) throw new Error(error.message);
  return {
    ...validar(data),
    lugares_casados: await contarLugares(supabase, "casado"),
    lugares_sin_coincidencia: await contarLugares(supabase, "sin-coincidencia"),
    clave_trabajador: claves.trabajador ? 1 : 0,
    clave_navegador: claves.navegador ? 1 : 0,
  };
}
