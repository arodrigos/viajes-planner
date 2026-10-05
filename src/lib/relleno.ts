import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstadoRelleno } from "@/lib/salud";

// sal-ac2: 60 s de caché en memoria del proceso -- diez peticiones seguidas
// a /api/salud producen una sola tanda de consultas de recuento, no diez.
// Vive a nivel de módulo porque un endpoint público y sin autenticar no
// puede convertirse en un amplificador de carga sobre `paradas`/`planes`.
const TTL_MS = 60_000;
let cacheEntrada: { valor: EstadoRelleno; calculadoEn: number } | null = null;

async function contar(
  constructor: () => { count: number | null; error: { message: string } | null } | PromiseLike<{
    count: number | null;
    error: { message: string } | null;
  }>,
): Promise<number> {
  const { count, error } = await constructor();
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// sal-ac1/sal-ac2: cada número sale de una consulta de SOLO RECUENTO
// (`head: true, count: 'exact'`), sin traer ni una fila de datos. Las dos
// cuentas "sin X" se derivan por resta sobre el total en vez de un left
// join con NULL, porque PostgREST solo soporta inner join al embeber un
// recurso -- es la forma de contar "sin versión" / "sin trabajo vivo" sin
// traer una sola fila de contenido.
async function calcular(supabase: SupabaseClient): Promise<EstadoRelleno> {
  const [
    paradasTotal,
    paradasResueltas,
    paradasNoResueltas,
    paradasEnError,
    paradasSinIntentar,
    paradasConFoto,
    paradasConAlternativas,
    paradasConCategoria,
    planesTotal,
    planesConVersion,
    planesConTrabajoVivo,
    planesConCiudad,
    planesSinCiudadIdentificable,
    planesSelladosPocasParadas,
    planesSelladosSinCaja,
    planesSelladosZonaGrande,
    planesSelladosSinContencion,
    planesSelladosSinVentaja,
    planesSelladosSinCandidatoClaro,
    planesSelladosCiudadNoEncontrada,
  ] = await Promise.all([
    contar(() => supabase.from("paradas").select("id", { count: "exact", head: true })),
    contar(() => supabase.from("paradas").select("id", { count: "exact", head: true }).eq("resolucion->>estado", "resuelta")),
    contar(() =>
      supabase.from("paradas").select("id", { count: "exact", head: true }).eq("resolucion->>estado", "no-resuelta"),
    ),
    contar(() => supabase.from("paradas").select("id", { count: "exact", head: true }).eq("resolucion->>estado", "error")),
    contar(() => supabase.from("paradas").select("id", { count: "exact", head: true }).is("resolucion", null)),
    contar(() => supabase.from("paradas").select("id", { count: "exact", head: true }).not("foto", "is", null)),
    contar(() =>
      supabase.from("paradas").select("id, paradas_alternativas!inner(id)", { count: "exact", head: true }),
    ),
    contar(() => supabase.from("paradas").select("id", { count: "exact", head: true }).not("categoria", "is", null)),
    contar(() => supabase.from("planes").select("id", { count: "exact", head: true })),
    contar(() => supabase.from("planes").select("id, plan_versiones!inner(id)", { count: "exact", head: true })),
    contar(() =>
      supabase
        .from("planes")
        .select("id, trabajos!inner(id)", { count: "exact", head: true })
        .is("trabajos.eliminado_en", null),
    ),
    contar(() => supabase.from("planes").select("id", { count: "exact", head: true }).eq("ciudad->>estado", "resuelta")),
    contar(() =>
      supabase.from("planes").select("id", { count: "exact", head: true }).eq("ciudad->>estado", "sin-ciudad-identificable"),
    ),
    // bar-ac4: desglose por categoría cerrada -- un solo campo jsonb
    // (`ciudad->>categoria_motivo`), sin join, igual de barato que el resto.
    contar(() => supabase.from("planes").select("id", { count: "exact", head: true }).eq("ciudad->>categoria_motivo", "pocas-paradas")),
    contar(() => supabase.from("planes").select("id", { count: "exact", head: true }).eq("ciudad->>categoria_motivo", "sin-caja")),
    contar(() => supabase.from("planes").select("id", { count: "exact", head: true }).eq("ciudad->>categoria_motivo", "zona-grande")),
    contar(() => supabase.from("planes").select("id", { count: "exact", head: true }).eq("ciudad->>categoria_motivo", "sin-contencion")),
    contar(() => supabase.from("planes").select("id", { count: "exact", head: true }).eq("ciudad->>categoria_motivo", "sin-ventaja")),
    contar(() => supabase.from("planes").select("id", { count: "exact", head: true }).eq("ciudad->>categoria_motivo", "sin-candidato-claro")),
    contar(() => supabase.from("planes").select("id", { count: "exact", head: true }).eq("ciudad->>categoria_motivo", "ciudad-no-encontrada")),
  ]);

  return {
    paradas_total: paradasTotal,
    paradas_resueltas: paradasResueltas,
    paradas_no_resueltas: paradasNoResueltas,
    paradas_en_error: paradasEnError,
    paradas_sin_intentar: paradasSinIntentar,
    paradas_con_foto: paradasConFoto,
    paradas_con_alternativas: paradasConAlternativas,
    paradas_con_categoria: paradasConCategoria,
    planes_total: planesTotal,
    planes_sin_version: planesTotal - planesConVersion,
    planes_sin_trabajo_vivo: planesTotal - planesConTrabajoVivo,
    planes_con_ciudad: planesConCiudad,
    planes_sin_ciudad_identificable: planesSinCiudadIdentificable,
    planes_sellados_pocas_paradas: planesSelladosPocasParadas,
    planes_sellados_sin_caja: planesSelladosSinCaja,
    planes_sellados_zona_grande: planesSelladosZonaGrande,
    planes_sellados_sin_contencion: planesSelladosSinContencion,
    planes_sellados_sin_ventaja: planesSelladosSinVentaja,
    planes_sellados_sin_candidato_claro: planesSelladosSinCandidatoClaro,
    planes_sellados_ciudad_no_encontrada: planesSelladosCiudadNoEncontrada,
  };
}

// sal-ac1: si cualquiera de las consultas falla, se propaga el error al
// llamador (route.ts), que omite `relleno` entero de la respuesta en vez de
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
