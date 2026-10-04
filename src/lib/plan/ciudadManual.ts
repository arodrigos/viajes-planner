import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";

export type ResultadoCiudadManual = { estado: "guardada" } | { estado: "demasiado-pronto" } | { estado: "nombre-vacio" };

const MINUTOS_MINIMOS_ENTRE_ENVIOS = 60;
// man-ac2/man-ac4 (límites): recortado y como mucho 80 caracteres -- un
// nombre más largo que eso no aporta nada a Nominatim y es el único límite
// que el diseño fija explícitamente.
const LONGITUD_MAXIMA_NOMBRE = 80;

// Invariante del diseño: "para cualquier entrada de texto, el nombre
// pedido se guarda recortado y con un máximo de 80 caracteres" -- función
// pura, separada de pedirCiudadManual, para poder comprobarla con un
// property test (fast-check) sin necesitar Supabase.
export function recortarNombrePedido(crudo: string): string {
  return crudo.trim().slice(0, LONGITUD_MAXIMA_NOMBRE);
}

// ciudad-a-mano: ÚNICA escritura de este bloque -- siempre la columna
// `planes.ciudad` entera, nunca una fila de `trabajos` ni de `paradas`
// (invariante del diseño). La geocodificación real la hace el trabajador
// en el siguiente tick (barrido.ts/resolverPuertaDeCiudad), nunca aquí:
// por eso este módulo no importa nada de src/lib/lugares salvo el tipo.
export async function pedirCiudadManual(supabase: SupabaseClient, planId: string, nombrePedidoCrudo: string): Promise<ResultadoCiudadManual> {
  const nombrePedido = recortarNombrePedido(nombrePedidoCrudo);
  if (nombrePedido.length === 0) return { estado: "nombre-vacio" };

  const { data: fila, error } = await supabase.from("planes").select("ciudad").eq("id", planId).maybeSingle();
  if (error) throw new Error(`No se pudo leer la ciudad del plan: ${error.message}`);
  const ciudadActual = (fila?.ciudad ?? null) as CiudadEfectiva | null;

  if (ciudadActual?.pedido_en) {
    const minutosDesde = (Date.now() - new Date(ciudadActual.pedido_en).getTime()) / 60_000;
    if (minutosDesde < MINUTOS_MINIMOS_ENTRE_ENVIOS) return { estado: "demasiado-pronto" };
  }

  const ahora = new Date().toISOString();
  const nuevaCiudad: CiudadEfectiva = { estado: "pendiente-manual", nombre_pedido: nombrePedido, pedido_en: ahora, intentado_en: ahora };

  const { error: errorEscritura } = await supabase.from("planes").update({ ciudad: nuevaCiudad }).eq("id", planId);
  if (errorEscritura) throw new Error(`No se pudo guardar la ciudad pedida a mano: ${errorEscritura.message}`);

  return { estado: "guardada" };
}
