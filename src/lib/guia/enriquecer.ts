import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import type { FuenteFotos } from "@/lib/lugares/tipos";
import { paginaPropiaDe } from "@/lib/lugares/resolverFotos";
import { relojReal, type Reloj } from "@/lib/lugares/limitador";
import type { CosteParada, EtapaPlan, Lugar } from "@/lib/plan/tipos";
import { asignarFichas } from "./asignar";
import { extraerCuriosidades } from "./curiosidades";
import type { FichaGuia } from "./wikitexto";
import { EsperaExcedida, FalloFuenteGuia, type FuenteGuia } from "./wikivoyage";

// Sube cuando cambia lo que se guarda en `guia`: el barrido vuelve a pedir,
// una vez, las paradas guardadas con un formato anterior. 2 = consejo hasta
// MAX_CONSEJO (el 1 implícito, null, cortaba a 400). 3 = curiosidades
// elegidas entre frases literales y hechos de Wikidata (curiosidadesPlan). 4 = frases unidas tras iniciales y siglas con
// punto («John F. Kennedy», «U.S.»): lo guardado con cortes se vuelve a elegir.
export const FORMATO_GUIA = 4;

export interface DependenciasGuia {
  fuenteGuia: FuenteGuia;
  fuenteFotos: FuenteFotos;
  reloj?: Reloj;
  // Las curiosidades las escribe curiosidadesPlan (con su propia fuente y el
  // modelo): este paso ya no toca la columna, para no pisar lo elegido.
  curiosidadesAparte?: boolean;
}

export interface ResultadoGuia {
  intentadas: number;
  con_guia: number;
  con_curiosidades: number;
  // Quedan para el siguiente tick: la fuente falló o no cabía su ritmo.
  pospuestas: number;
}

export const resultadoGuiaVacio = (): ResultadoGuia => ({ intentadas: 0, con_guia: 0, con_curiosidades: 0, pospuestas: 0 });

export interface VersionParaGuia {
  id: string;
  ciudad: CiudadEfectiva | null;
  etapas?: EtapaPlan[] | null;
}

// Una fila de `paradas` o de `paradas_alternativas`: comparten la guía pero
// solo las paradas tienen coste.
interface FilaParadaGuia {
  tabla?: "paradas" | "paradas_alternativas";
  id: string;
  nombre: string;
  lat: number | null;
  lon: number | null;
  lugar: Lugar | null;
  coste: CosteParada | null;
  dia_index: number;
  plan_version_id: string;
}

// La ciudad cuya guía se pide: la de la etapa del día en un viaje de varias
// ciudades, la efectiva del plan en uno de una.
export function ciudadDeParada(version: VersionParaGuia, diaIndex: number): string | null {
  const etapa = version.etapas?.find((e) => diaIndex >= e.dia_inicio && diaIndex < e.dia_inicio + e.dias);
  const ciudad = etapa ? etapa.ciudad : version.ciudad;
  return ciudad?.estado === "resuelta" && ciudad.nombre ? ciudad.nombre : null;
}

function urlWikipedia(lang: string, titulo: string): string | null {
  return /^[a-z]{2,3}$/.test(lang) ? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(titulo.replace(/ /g, "_"))}` : null;
}

async function curiosidadesDe(fuente: FuenteFotos, fila: FilaParadaGuia): Promise<{ frases: string[]; url: string } | null> {
  const pagina = paginaPropiaDe(fila.lugar ?? undefined);
  if (!pagina) return null;
  const resumen = await fuente.resumenPagina(pagina.lang, pagina.titulo);
  const url = urlWikipedia(pagina.lang, pagina.titulo);
  if (!resumen?.extracto || !url) return null;
  const compacto = resumen.extracto.replace(/\s+/g, " ");
  // Cada frase tiene que aparecer tal cual en el extracto: es lo que
  // permite rotularla «de Wikipedia».
  const frases = extraerCuriosidades(resumen.extracto).filter((f) => compacto.includes(f));
  return frases.length > 0 ? { frases, url } : null;
}

export async function enriquecerParadas(
  supabase: SupabaseClient,
  deps: DependenciasGuia,
  filas: Array<FilaParadaGuia & { ciudad: string | null }>,
  hasta?: number,
): Promise<ResultadoGuia> {
  const resultado = resultadoGuiaVacio();
  const grupos = new Map<string, Array<FilaParadaGuia & { ciudad: string | null }>>();
  for (const fila of filas) {
    const clave = fila.ciudad ?? "";
    grupos.set(clave, [...(grupos.get(clave) ?? []), fila]);
  }

  for (const [ciudad, grupo] of grupos) {
    let fichas = new Map<string, FichaGuia>();
    let urlGuia = "";
    if (ciudad) {
      try {
        const pagina = await deps.fuenteGuia.paginaCiudad(ciudad, hasta);
        if (pagina) {
          urlGuia = pagina.url;
          const comoAsignable = (f: FilaParadaGuia) => ({ id: f.id, nombre: f.nombre, ...(f.lat !== null && f.lon !== null ? { coordenadas: { lat: f.lat, lon: f.lon } } : {}) });
          // Las paradas eligen primero: una alternativa nunca le quita su ficha
          // a la parada del plan, solo aprovecha las que sobran. Todo sale de
          // la misma página, sin ninguna petición más.
          fichas = asignarFichas(pagina.fichas, grupo.filter((f) => f.tabla !== "paradas_alternativas").map(comoAsignable));
          const usadas = new Set(fichas.values());
          const sobrantes = asignarFichas(
            pagina.fichas.filter((ficha) => !usadas.has(ficha)),
            grupo.filter((f) => f.tabla === "paradas_alternativas").map(comoAsignable),
          );
          for (const [id, ficha] of sobrantes) fichas.set(id, ficha);
        }
      } catch (error) {
        // Ni un fallo de la fuente ni quedarse sin hueco de ritmo gastan el
        // intento: se reintenta en el siguiente tick.
        if (error instanceof FalloFuenteGuia || error instanceof EsperaExcedida) {
          resultado.pospuestas += grupo.length;
          continue;
        }
        throw error;
      }
    }

    for (const fila of grupo) {
      const ficha = fichas.get(fila.id);
      let curiosidades: { frases: string[]; url: string } | null = null;
      try {
        curiosidades = deps.curiosidadesAparte ? null : await curiosidadesDe(deps.fuenteFotos, fila);
      } catch {
        curiosidades = null;
      }
      const ahora = new Date((deps.reloj ?? relojReal).ahora());
      const precioDeFuente = ficha?.precio_eur;
      const coste: CosteParada | undefined =
        precioDeFuente !== undefined
          ? {
              importe_eur: precioDeFuente,
              por: precioDeFuente === 0 ? "gratis" : "persona",
              procedencia: "wikivoyage",
              fecha: ahora.toISOString().slice(0, 10),
            }
          : undefined;
      const { error } = await supabase
        .from(fila.tabla ?? "paradas")
        .update({
          guia: ficha
            ? {
                consejo: ficha.contenido,
                ...(ficha.precio_texto ? { precio_texto: ficha.precio_texto } : {}),
                ...(precioDeFuente !== undefined ? { precio_eur: precioDeFuente } : {}),
                url: urlGuia,
                licencia: "CC BY-SA",
              }
            : null,
          ...(deps.curiosidadesAparte ? {} : { curiosidades }),
          ...(coste && fila.tabla !== "paradas_alternativas" ? { coste } : {}),
          guia_intentada_en: ahora.toISOString(),
          guia_formato: FORMATO_GUIA,
        })
        .eq("id", fila.id);
      if (error) throw new Error(`No se pudo guardar la guía de ${fila.tabla ?? "paradas"}: ${error.message}`);
      resultado.intentadas += 1;
      if (ficha) resultado.con_guia += 1;
      if (curiosidades) resultado.con_curiosidades += 1;
    }
  }
  return resultado;
}

// Paradas ya resueltas (y sus alternativas con coordenadas), de las versiones
// dadas, a las que aún no se ha mirado la guía o que se guardaron con un
// formato anterior (guia_formato siempre se escribe al intentar, así que null
// cubre ambas cosas). Las que no tienen coordenadas no se piden: sin ubicación
// comprobada no hay forma fiable de asignar ficha.
export async function enriquecerGuiaPendientes(
  supabase: SupabaseClient,
  deps: DependenciasGuia,
  versiones: VersionParaGuia[],
  limite: number,
  hasta?: number,
): Promise<ResultadoGuia> {
  if (versiones.length === 0) return resultadoGuiaVacio();
  const { data, error } = await supabase
    .from("paradas")
    .select("id, nombre, lat, lon, lugar, coste, dia_index, plan_version_id")
    .in("plan_version_id", versiones.map((v) => v.id))
    .eq("resolucion->>estado", "resuelta")
    .or(`guia_formato.is.null,guia_formato.lt.${FORMATO_GUIA}`)
    .limit(limite);
  if (error) throw new Error(`No se pudieron leer las paradas sin guía: ${error.message}`);
  const porId = new Map(versiones.map((v) => [v.id, v]));
  const filas: Array<FilaParadaGuia & { ciudad: string | null }> = ((data as FilaParadaGuia[] | null) ?? []).map((f) => {
    const version = porId.get(f.plan_version_id);
    return { ...f, tabla: "paradas", ciudad: version ? ciudadDeParada(version, f.dia_index) : null };
  });

  // Las alternativas con coordenadas (las que la resolución ya comprobó) van en
  // el mismo lote, tras las paradas y dentro del mismo límite: así se comparte
  // la página de la ciudad y el ritmo por tick no cambia.
  const hueco = limite - filas.length;
  if (hueco > 0) {
    const { data: dataAlt, error: errorAlt } = await supabase
      .from("paradas_alternativas")
      .select("id, nombre, lat, lon, lugar, paradas!inner(dia_index, plan_version_id)")
      .in("paradas.plan_version_id", versiones.map((v) => v.id))
      .not("lat", "is", null)
      .or(`guia_formato.is.null,guia_formato.lt.${FORMATO_GUIA}`)
      .limit(hueco);
    if (errorAlt) throw new Error(`No se pudieron leer las alternativas sin guía: ${errorAlt.message}`);
    type FilaAlt = Omit<FilaParadaGuia, "coste" | "dia_index" | "plan_version_id"> & { paradas: { dia_index: number; plan_version_id: string } | Array<{ dia_index: number; plan_version_id: string }> };
    for (const f of (dataAlt as FilaAlt[] | null) ?? []) {
      const padre = Array.isArray(f.paradas) ? f.paradas[0] : f.paradas;
      const version = porId.get(padre.plan_version_id);
      filas.push({
        tabla: "paradas_alternativas",
        id: f.id,
        nombre: f.nombre,
        lat: f.lat,
        lon: f.lon,
        lugar: f.lugar,
        coste: null,
        dia_index: padre.dia_index,
        plan_version_id: padre.plan_version_id,
        ciudad: version ? ciudadDeParada(version, padre.dia_index) : null,
      });
    }
  }
  return enriquecerParadas(supabase, deps, filas, hasta);
}

// Tras guardar un plan nuevo: misma lógica que el barrido, sobre su última
// versión. Nunca lanza: la guía no puede tumbar un plan ya completado.
export async function enriquecerGuiaDePlan(
  supabase: SupabaseClient,
  deps: DependenciasGuia,
  planId: string,
  limite = 120,
  presupuestoMs = 90_000,
): Promise<ResultadoGuia> {
  try {
    const { data } = await supabase
      .from("plan_versiones")
      .select("id, etapas, planes(ciudad)")
      .eq("plan_id", planId)
      .order("version", { ascending: false })
      .limit(1);
    const fila = data?.[0] as { id: string; etapas: EtapaPlan[] | null; planes: { ciudad: CiudadEfectiva | null } | Array<{ ciudad: CiudadEfectiva | null }> | null } | undefined;
    if (!fila) return resultadoGuiaVacio();
    const plan = Array.isArray(fila.planes) ? fila.planes[0] : fila.planes;
    const reloj = deps.reloj ?? relojReal;
    return await enriquecerGuiaPendientes(supabase, deps, [{ id: fila.id, ciudad: plan?.ciudad ?? null, etapas: fila.etapas }], limite, reloj.ahora() + presupuestoMs);
  } catch {
    return resultadoGuiaVacio();
  }
}
