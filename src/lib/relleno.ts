import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstadoRelleno } from "@/lib/salud";
import { FORMATO_CURIOSIDADES } from "@/lib/guia/curiosidadesPlan";

// sal-ac2: 60 s de caché en memoria del proceso -- diez peticiones seguidas
// a /api/salud producen una sola llamada a la base, no diez.
// Vive a nivel de módulo porque un endpoint público y sin autenticar no
// puede convertirse en un amplificador de carga sobre `paradas`/`planes`.
const TTL_MS = 60_000;
let cacheEntrada: { valor: EstadoRelleno; calculadoEn: number } | null = null;

// Lista cerrada: el `Record` obliga a que cada clave de EstadoRelleno esté
// aquí, así que añadir una al tipo sin añadirla a la función SQL (o al revés)
// rompe el tipado o la validación, no se cuela en silencio.
const CLAVES_RELLENO: Record<keyof EstadoRelleno, true> = {
  paradas_total: true,
  paradas_resueltas: true,
  paradas_no_resueltas: true,
  paradas_en_error: true,
  paradas_sin_intentar: true,
  paradas_con_foto: true,
  paradas_con_alternativas: true,
  paradas_con_categoria: true,
  paradas_con_guia: true,
  paradas_con_motivo: true,
  curiosidades_formato_antiguo: true,
  versiones_con_eventos: true,
  versiones_multiciudad: true,
  trabajos_inviables: true,
  planes_total: true,
  planes_sin_version: true,
  planes_sin_trabajo_vivo: true,
  planes_con_ciudad: true,
  planes_sin_ciudad_identificable: true,
  planes_sellados_pocas_paradas: true,
  planes_sellados_sin_caja: true,
  planes_sellados_zona_grande: true,
  planes_sellados_sin_contencion: true,
  planes_sellados_sin_ventaja: true,
  planes_sellados_sin_candidato_claro: true,
  planes_sellados_ciudad_no_encontrada: true,
};

// /api/salud es público: lo que sale de la base solo se publica si tiene
// exactamente la forma esperada (las claves de la lista y enteros >= 0). Si la
// función devolviera otra cosa, mejor omitir `relleno` que filtrar texto.
function validarRelleno(valor: unknown): EstadoRelleno {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    throw new Error("estado_relleno() no devolvió un objeto");
  }
  const claves = Object.keys(CLAVES_RELLENO);
  const recibidas = Object.keys(valor);
  if (recibidas.length !== claves.length || !claves.every((clave) => clave in valor)) {
    throw new Error("estado_relleno() no devolvió exactamente las claves esperadas");
  }
  for (const clave of claves) {
    const numero = (valor as Record<string, unknown>)[clave];
    if (typeof numero !== "number" || !Number.isInteger(numero) || numero < 0) {
      throw new Error(`estado_relleno(): ${clave} no es un entero no negativo`);
    }
  }
  return valor as EstadoRelleno;
}

// El formato vigente de las curiosidades se pasa desde aquí, que es donde
// vive, en vez de copiarlo a SQL: así subirlo no exige otra migración.
async function calcular(supabase: SupabaseClient): Promise<EstadoRelleno> {
  const { data, error } = await supabase.rpc("estado_relleno", { p_formato_curiosidades: FORMATO_CURIOSIDADES });
  if (error) throw new Error(error.message);
  return validarRelleno(data);
}

// sal-ac1: si la llamada falla o su resultado no valida, se propaga el error
// al llamador (route.ts), que omite `relleno` entero de la respuesta en vez de
// devolver 500 -- el resto de /api/salud sigue sirviendo.
export async function leerEstadoRelleno(supabase: SupabaseClient, ahora: number = Date.now()): Promise<EstadoRelleno> {
  if (cacheEntrada && ahora - cacheEntrada.calculadoEn < TTL_MS) {
    return cacheEntrada.valor;
  }
  const valor = await calcular(supabase);
  cacheEntrada = { valor, calculadoEn: ahora };
  return valor;
}

// Solo para tests: la caché es un estado de módulo que, sin esto, filtraría
// entre ficheros de test y entre casos del mismo fichero.
export function _reiniciarCacheRellenoParaTests(): void {
  cacheEntrada = null;
}
