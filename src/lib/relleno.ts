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

export interface RecuentosRelleno {
  paradasTotal: number;
  paradasResueltas: number;
  paradasNoResueltas: number;
  paradasEnError: number;
  paradasSinIntentar: number;
  paradasConFoto: number;
  paradasConAlternativas: number;
  paradasConCategoria: number;
  paradasConGuia: number;
  paradasConMotivo: number;
  versionesConEventos: number;
  versionesMulticiudad: number;
  trabajosInviables: number;
  planesTotal: number;
  planesConVersion: number;
  planesConTrabajoVivo: number;
  planesConCiudad: number;
  planesSinCiudadIdentificable: number;
  planesSelladosPocasParadas: number;
  planesSelladosSinCaja: number;
  planesSelladosZonaGrande: number;
  planesSelladosSinContencion: number;
  planesSelladosSinVentaja: number;
  planesSelladosSinCandidatoClaro: number;
  planesSelladosCiudadNoEncontrada: number;
}

// Pura y aparte de las consultas para poder comprobar con propiedades que
// la forma del objeto no depende de los datos: las dos cuentas «sin X» son
// una resta, y es lo único que aquí se calcula.
export function armarEstadoRelleno(r: RecuentosRelleno): EstadoRelleno {
  return {
    paradas_total: r.paradasTotal,
    paradas_resueltas: r.paradasResueltas,
    paradas_no_resueltas: r.paradasNoResueltas,
    paradas_en_error: r.paradasEnError,
    paradas_sin_intentar: r.paradasSinIntentar,
    paradas_con_foto: r.paradasConFoto,
    paradas_con_alternativas: r.paradasConAlternativas,
    paradas_con_categoria: r.paradasConCategoria,
    paradas_con_guia: r.paradasConGuia,
    paradas_con_motivo: r.paradasConMotivo,
    versiones_con_eventos: r.versionesConEventos,
    versiones_multiciudad: r.versionesMulticiudad,
    trabajos_inviables: r.trabajosInviables,
    planes_total: r.planesTotal,
    planes_sin_version: r.planesTotal - r.planesConVersion,
    planes_sin_trabajo_vivo: r.planesTotal - r.planesConTrabajoVivo,
    planes_con_ciudad: r.planesConCiudad,
    planes_sin_ciudad_identificable: r.planesSinCiudadIdentificable,
    planes_sellados_pocas_paradas: r.planesSelladosPocasParadas,
    planes_sellados_sin_caja: r.planesSelladosSinCaja,
    planes_sellados_zona_grande: r.planesSelladosZonaGrande,
    planes_sellados_sin_contencion: r.planesSelladosSinContencion,
    planes_sellados_sin_ventaja: r.planesSelladosSinVentaja,
    planes_sellados_sin_candidato_claro: r.planesSelladosSinCandidatoClaro,
    planes_sellados_ciudad_no_encontrada: r.planesSelladosCiudadNoEncontrada,
  };
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
    paradasConGuia,
    versionesConEventos,
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
    versionesMulticiudad,
    trabajosInviables,
    paradasConMotivo,
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
    contar(() => supabase.from("paradas").select("id", { count: "exact", head: true }).not("guia", "is", null)),
    contar(() => supabase.from("plan_versiones").select("id", { count: "exact", head: true }).not("eventos_intentados_en", "is", null)),
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
    // `etapas` es jsonb: «no nulo y no vacío» son dos filtros porque un
    // viaje de una ciudad puede haberse guardado como null o como [].
    contar(() =>
      supabase.from("plan_versiones").select("id", { count: "exact", head: true }).not("etapas", "is", null).neq("etapas", "[]"),
    ),
    contar(() => supabase.from("trabajos").select("id", { count: "exact", head: true }).not("inviable", "is", null)),
    contar(() =>
      supabase.from("paradas").select("id", { count: "exact", head: true }).not("motivo", "is", null).neq("motivo", ""),
    ),
  ]);

  return armarEstadoRelleno({
    paradasTotal,
    paradasResueltas,
    paradasNoResueltas,
    paradasEnError,
    paradasSinIntentar,
    paradasConFoto,
    paradasConAlternativas,
    paradasConCategoria,
    paradasConGuia,
    paradasConMotivo,
    versionesConEventos,
    versionesMulticiudad,
    trabajosInviables,
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
  });
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
