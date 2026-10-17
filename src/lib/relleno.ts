import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstadoRelleno } from "@/lib/salud";
import { FORMATO_CURIOSIDADES } from "@/lib/guia/curiosidadesPlan";

// sal-ac2: 60 s de caché en memoria del proceso -- diez peticiones seguidas
// a /api/salud producen una sola lectura de la base, no diez.
// Vive a nivel de módulo porque un endpoint público y sin autenticar no
// puede convertirse en un amplificador de carga sobre `paradas`/`planes`.
const TTL_MS = 60_000;
let cacheEntrada: { valor: EstadoRelleno; calculadoEn: number } | null = null;

// Lista cerrada: el `Record` obliga a que cada clave de EstadoRelleno esté
// aquí, con la función SQL que la devuelve, así que añadir una al tipo sin
// añadirla a la función (o al revés) rompe el tipado o la validación, no se
// cuela en silencio.
type FuncionRelleno = "estado_relleno" | "estado_relleno_motivos";
const CLAVES_RELLENO: Record<keyof EstadoRelleno, FuncionRelleno> = {
  paradas_total: "estado_relleno",
  paradas_resueltas: "estado_relleno",
  paradas_no_resueltas: "estado_relleno",
  paradas_en_error: "estado_relleno",
  paradas_sin_intentar: "estado_relleno",
  paradas_con_foto: "estado_relleno",
  paradas_con_alternativas: "estado_relleno",
  paradas_con_categoria: "estado_relleno",
  paradas_con_guia: "estado_relleno",
  paradas_con_motivo: "estado_relleno",
  curiosidades_formato_antiguo: "estado_relleno",
  versiones_con_eventos: "estado_relleno",
  versiones_multiciudad: "estado_relleno",
  trabajos_inviables: "estado_relleno",
  planes_total: "estado_relleno",
  planes_sin_version: "estado_relleno",
  planes_sin_trabajo_vivo: "estado_relleno",
  planes_con_ciudad: "estado_relleno",
  planes_sin_ciudad_identificable: "estado_relleno",
  planes_sellados_pocas_paradas: "estado_relleno",
  planes_sellados_sin_caja: "estado_relleno",
  planes_sellados_zona_grande: "estado_relleno",
  planes_sellados_sin_contencion: "estado_relleno",
  planes_sellados_sin_ventaja: "estado_relleno",
  planes_sellados_sin_candidato_claro: "estado_relleno",
  planes_sellados_ciudad_no_encontrada: "estado_relleno",
  paradas_no_resueltas_sin_candidatos: "estado_relleno_motivos",
  paradas_no_resueltas_fuera_de_caja: "estado_relleno_motivos",
  paradas_no_resueltas_nombre_distinto: "estado_relleno_motivos",
  paradas_no_resueltas_tipo_incompatible: "estado_relleno_motivos",
  paradas_no_resueltas_motivo_desconocido: "estado_relleno_motivos",
  paradas_con_toponimo: "estado_relleno_motivos",
  paradas_sin_intentar_ultima_version: "estado_relleno_motivos",
};

// /api/salud es público: lo que sale de la base solo se publica si tiene
// exactamente la forma esperada (las claves de esa función y enteros >= 0).
// Si la función devolviera otra cosa, mejor omitirlo que filtrar texto.
function validarSalida(funcion: FuncionRelleno, valor: unknown): Record<string, number> {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    throw new Error(`${funcion}() no devolvió un objeto`);
  }
  const claves = Object.entries(CLAVES_RELLENO).filter(([, origen]) => origen === funcion).map(([clave]) => clave);
  const recibidas = Object.keys(valor);
  if (recibidas.length !== claves.length || !claves.every((clave) => Object.hasOwn(valor, clave))) {
    throw new Error(`${funcion}() no devolvió exactamente las claves esperadas`);
  }
  for (const clave of claves) {
    const numero = (valor as Record<string, unknown>)[clave];
    if (typeof numero !== "number" || !Number.isInteger(numero) || numero < 0) {
      throw new Error(`${funcion}(): ${clave} no es un entero no negativo`);
    }
  }
  return valor as Record<string, number>;
}

// El desglose por motivo vive en una función aparte para no cambiar la
// salida de estado_relleno, que valida con su lista exacta cualquier web ya
// desplegada. Es opcional: entre el despliegue y la migración no existe, y
// si falla o no valida se publica el resto sin esas claves.
async function leerMotivos(supabase: SupabaseClient): Promise<Record<string, number>> {
  try {
    const { data, error } = await supabase.rpc("estado_relleno_motivos");
    if (error) return {};
    return validarSalida("estado_relleno_motivos", data);
  } catch {
    return {};
  }
}

// El formato vigente de las curiosidades se pasa desde aquí, que es donde
// vive, en vez de copiarlo a SQL: así subirlo no exige otra migración.
async function calcular(supabase: SupabaseClient): Promise<EstadoRelleno> {
  const [base, motivos] = await Promise.all([
    supabase.rpc("estado_relleno", { p_formato_curiosidades: FORMATO_CURIOSIDADES }),
    leerMotivos(supabase),
  ]);
  if (base.error) throw new Error(base.error.message);
  return { ...validarSalida("estado_relleno", base.data), ...motivos } as unknown as EstadoRelleno;
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
