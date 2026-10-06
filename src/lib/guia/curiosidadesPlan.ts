import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EjecutorModelo } from "@/lib/trabajador/ejecutorModelo";
import type { CuriosidadesParada, Lugar } from "@/lib/plan/tipos";
import { construirCandidatas, type FuenteCuriosidades, type SitioCuriosidades } from "./candidatas";
import { FORMATO_GUIA, type VersionParaGuia } from "./enriquecer";
import { sanearItems } from "./sanear";
import { seleccionarCuriosidades } from "./seleccionarCuriosidades";
import { FalloFuenteCuriosidades } from "./fuenteCuriosidades";

export interface DependenciasCuriosidades {
  fuente: FuenteCuriosidades;
  ejecutor: EjecutorModelo;
  directorio: string;
}

// 4 = hechos de Wikidata redactados sin confundir fundación con apertura y
// frases partidas con la lista de abreviaturas.
// 5 = edificio con museo no sale como institución, saltos de línea simples
// unidos, frases en minúscula descartadas y cortes tras inicial o sigla solo
// cuando lo siguiente abre frase. Subirlo hace que el trabajador rehaga la
// última versión de cada plan; huella.ts obliga a subirlo si cambian las reglas.
export const FORMATO_CURIOSIDADES = 5;

export interface ResultadoCuriosidades {
  versionesProcesadas: number;
  sitios: number;
  invocaciones: number;
  pospuestas: number;
}

export const resultadoCuriosidadesVacio = (): ResultadoCuriosidades => ({ versionesProcesadas: 0, sitios: 0, invocaciones: 0, pospuestas: 0 });

interface FilaSitio {
  tabla: "paradas" | "paradas_alternativas";
  id: string;
  nombre: string;
  lugar: Lugar | null;
  curiosidades: CuriosidadesParada | null;
  guia_formato: number | null;
}

// Un sitio está pendiente si nunca pasó por aquí (sin items) o si solo tiene
// el respaldo y aún no se le ha dado su única oportunidad con el modelo.
// El formato antiguo (sin marca) se reprocesa una vez: las candidatas cambiaron
// (fundación frente a apertura, frases cortadas por abreviatura).
export function pendiente(c: CuriosidadesParada | null): boolean {
  if (!c || !Array.isArray(c.items)) return true;
  if ((c.formato ?? 0) < FORMATO_CURIOSIDADES) return true;
  return c.seleccion === "heuristica" && c.mejora_intentada !== true;
}

async function leerSitios(supabase: SupabaseClient, versionId: string): Promise<FilaSitio[]> {
  const { data: paradas, error } = await supabase
    .from("paradas")
    .select("id, nombre, lugar, curiosidades, guia_formato")
    .eq("plan_version_id", versionId)
    .eq("resolucion->>estado", "resuelta");
  if (error) throw new Error(`No se pudieron leer las paradas para curiosidades: ${error.message}`);
  const { data: alternativas, error: errorAlt } = await supabase
    .from("paradas_alternativas")
    .select("id, nombre, lugar, curiosidades, guia_formato, paradas!inner(plan_version_id)")
    .eq("paradas.plan_version_id", versionId)
    .not("lat", "is", null);
  if (errorAlt) throw new Error(`No se pudieron leer las alternativas para curiosidades: ${errorAlt.message}`);
  return [
    ...((paradas as Omit<FilaSitio, "tabla">[] | null) ?? []).map((f) => ({ ...f, tabla: "paradas" as const })),
    ...((alternativas as Omit<FilaSitio, "tabla">[] | null) ?? []).map((f) => ({ ...f, tabla: "paradas_alternativas" as const })),
  ];
}

// Como mucho UNA versión por tick y UNA invocación al modelo por versión,
// cubriendo paradas y alternativas a la vez. Cambiar de alternativa no entra
// aquí: sustituir hereda las curiosidades ya elegidas. Nunca lanza por el
// modelo; las fuentes caídas posponen la versión al siguiente tick.
export async function rellenarCuriosidadesPendientes(
  supabase: SupabaseClient,
  deps: DependenciasCuriosidades,
  versiones: VersionParaGuia[],
): Promise<ResultadoCuriosidades> {
  const resultado = resultadoCuriosidadesVacio();
  for (const version of versiones) {
    const filas = await leerSitios(supabase, version.id);
    // Hasta que la guía no ha pasado por todos los sitios (formato actual),
    // su turno no ha llegado: la guía los marca y este paso va detrás.
    if (filas.some((f) => f.guia_formato === null || f.guia_formato < FORMATO_GUIA)) continue;
    const pendientes = filas.filter((f) => pendiente(f.curiosidades));
    if (pendientes.length === 0) continue;

    const sitios: SitioCuriosidades[] = [
      ...pendientes.filter((f) => f.tabla === "paradas"),
      ...pendientes.filter((f) => f.tabla === "paradas_alternativas"),
    ].map((f) => ({ id: f.id, tipo: f.tabla === "paradas" ? ("parada" as const) : ("alternativa" as const), nombre: f.nombre, lugar: f.lugar }));

    let candidatas;
    try {
      candidatas = await construirCandidatas(sitios, deps.fuente);
    } catch (error) {
      if (error instanceof FalloFuenteCuriosidades) {
        resultado.pospuestas += pendientes.length;
        return resultado;
      }
      throw error;
    }

    const seleccion = await seleccionarCuriosidades(candidatas, deps.ejecutor, { directorio: deps.directorio });
    const porId = new Map(pendientes.map((f) => [f.id, f]));
    for (const { sitio } of candidatas) {
      const fila = porId.get(sitio.id) as FilaSitio;
      const elegido = seleccion.porSitio.get(sitio.id) ?? { items: [], vistoPorModelo: false };
      // Mismo saneado que al leer: lo que se guarda ya sale limpio.
      const items = sanearItems(elegido.items, FORMATO_CURIOSIDADES);
      const urlPagina = items.find((i) => i.fuente === "wikipedia" && i.idioma === "es")?.url.split("#")[0] ?? items.find((i) => i.fuente === "wikipedia")?.url.split("#")[0] ?? "";
      const todosModelo = items.length > 0 && items.every((i) => i.seleccion === "modelo");
      const curiosidades: CuriosidadesParada = {
        frases: items.filter((i) => i.fuente === "wikipedia" && i.idioma === "es").map((i) => i.texto),
        url: urlPagina,
        items,
        formato: FORMATO_CURIOSIDADES,
        seleccion: items.length === 0 || !todosModelo ? "heuristica" : "modelo",
        // Un sitio que ya tenía el respaldo agota aquí su única mejora.
        mejora_intentada: items.length === 0 || todosModelo || elegido.vistoPorModelo || (fila.curiosidades?.seleccion === "heuristica"),
      };
      const { error } = await supabase.from(fila.tabla).update({ curiosidades }).eq("id", fila.id);
      if (error) throw new Error(`No se pudieron guardar las curiosidades de ${fila.tabla}: ${error.message}`);
    }
    resultado.versionesProcesadas = 1;
    resultado.sitios = sitios.length;
    resultado.invocaciones = seleccion.invocaciones;
    return resultado;
  }
  return resultado;
}
