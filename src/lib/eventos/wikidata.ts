import "server-only";
import { claveEventos, type CacheSitios, esFalloDeCache } from "@/lib/lugares/cacheSitios";
import { userAgent } from "@/lib/lugares/fuenteAbierta";
import { crearLimitador, relojReal, type Reloj } from "@/lib/lugares/limitador";
import { FalloFuenteEventos, INTERVALO_MIN_MS } from "./festivos";
import { esFecha, esIdQ, esPais, esUrlDeFuente, limpiarNombre } from "./seguridad";

// Una fiesta de Wikidata: con fecha propia (P580/P582) o recurrente por día
// del año (P837, de ahí mes y día).
export interface FiestaWikidata {
  nombre: string;
  url: string;
  fecha?: string;
  fecha_fin?: string;
  mes?: number;
  dia?: number;
}

export interface CiudadWikidata {
  q: string;
  pais: string | null;
  fiestas: FiestaWikidata[];
}

export interface FuenteWikidata {
  ciudad(nombre: string): Promise<CiudadWikidata | null>;
}

export interface OpcionesFuenteWikidata {
  fetch?: typeof fetch;
  reloj?: Reloj;
  cache: CacheSitios;
}

const MESES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// P837 apunta a un elemento «día del año» cuya etiqueta inglesa es
// «June 13» (o «13 June»): es el único dato de fecha que trae.
export function mesYDia(etiqueta: string): { mes: number; dia: number } | null {
  const a = /^([A-Za-z]+) (\d{1,2})$/.exec(etiqueta.trim());
  const b = /^(\d{1,2}) ([A-Za-z]+)$/.exec(etiqueta.trim());
  const nombreMes = (a?.[1] ?? b?.[2] ?? "").toLowerCase();
  const dia = Number(a?.[2] ?? b?.[1]);
  const mes = MESES.indexOf(nombreMes) + 1;
  return mes >= 1 && dia >= 1 && dia <= 31 ? { mes, dia } : null;
}

// La única consulta de la aplicación a Wikidata. `q` ya está validado como
// identificador: nada de texto libre entra aquí.
export function consultaCiudad(q: string): string {
  if (!esIdQ(q)) throw new Error("Identificador de Wikidata no válido");
  return `SELECT ?e ?eLabel ?ini ?fin ?diaEn ?art ?iso WHERE {
  wd:${q} wdt:P17/wdt:P297 ?iso .
  OPTIONAL {
    {
      ?e wdt:P276|wdt:P131 wd:${q} .
      ?e wdt:P837 ?dia .
      ?dia rdfs:label ?diaEn .
      FILTER(LANG(?diaEn) = "en")
    } UNION {
      ?e wdt:P31/wdt:P279* wd:Q132241 .
      ?e wdt:P276|wdt:P131 wd:${q} .
      ?e wdt:P580 ?ini .
      OPTIONAL { ?e wdt:P582 ?fin }
    }
    OPTIONAL { ?art schema:about ?e ; schema:isPartOf <https://es.wikipedia.org/> }
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
} LIMIT 50`;
}

interface Celda {
  value?: string;
}
interface FilaSparql {
  e?: Celda;
  eLabel?: Celda;
  ini?: Celda;
  fin?: Celda;
  diaEn?: Celda;
  art?: Celda;
  iso?: Celda;
}

type EntradaCache = { ciudad: CiudadWikidata | null };
const esEntradaCache = (v: unknown): v is EntradaCache => typeof v === "object" && v !== null && "ciudad" in v;

export function crearFuenteWikidata(opciones: OpcionesFuenteWikidata): FuenteWikidata {
  const fetchImpl = opciones.fetch ?? fetch;
  const limitar = crearLimitador(INTERVALO_MIN_MS, opciones.reloj ?? relojReal);

  async function pedir(url: string, aceptar: string): Promise<unknown> {
    return limitar(async () => {
      let respuesta: Response;
      try {
        respuesta = await fetchImpl(url, { headers: { "User-Agent": userAgent(), Accept: aceptar }, signal: AbortSignal.timeout(20_000) });
      } catch {
        throw new FalloFuenteEventos("red");
      }
      if (!respuesta.ok) throw new FalloFuenteEventos(`HTTP ${respuesta.status}`);
      try {
        return await respuesta.json();
      } catch {
        throw new FalloFuenteEventos("respuesta sin JSON");
      }
    });
  }

  // El identificador Q de la ciudad sale de la página de Wikipedia que
  // lleva ese nombre; una página de desambiguación no vale.
  async function identificadorDe(nombre: string): Promise<string | null> {
    const parametros = new URLSearchParams({
      action: "query",
      prop: "pageprops",
      ppprop: "wikibase_item|disambiguation",
      redirects: "1",
      format: "json",
      formatversion: "2",
      titles: nombre,
    });
    const datos = (await pedir(`https://es.wikipedia.org/w/api.php?${parametros}`, "application/json")) as {
      query?: { pages?: Array<{ missing?: boolean; pageprops?: { wikibase_item?: string; disambiguation?: string } }> };
    };
    const pagina = datos.query?.pages?.[0];
    if (!pagina || pagina.missing || pagina.pageprops?.disambiguation !== undefined) return null;
    const q = pagina.pageprops?.wikibase_item;
    return esIdQ(q) ? q : null;
  }

  async function consultar(nombre: string): Promise<CiudadWikidata | null> {
    const q = await identificadorDe(nombre);
    if (!q) return null;
    const parametros = new URLSearchParams({ query: consultaCiudad(q), format: "json" });
    const datos = (await pedir(`https://query.wikidata.org/sparql?${parametros}`, "application/sparql-results+json")) as {
      results?: { bindings?: FilaSparql[] };
    };
    const filas = datos.results?.bindings;
    if (!Array.isArray(filas)) throw new FalloFuenteEventos("respuesta SPARQL inválida");
    const pais = filas.map((f) => f.iso?.value).find(esPais) ?? null;
    const fiestas: FiestaWikidata[] = [];
    for (const fila of filas) {
      const id = fila.e?.value?.replace("http://www.wikidata.org/entity/", "");
      const etiqueta = fila.eLabel?.value;
      if (!esIdQ(id) || !etiqueta) continue;
      const nombreFiesta = limpiarNombre(etiqueta);
      // La página de Wikipedia si existe; si no, la ficha de Wikidata.
      const articulo = fila.art?.value;
      const url = esUrlDeFuente("wikidata", articulo) ? articulo : `https://www.wikidata.org/wiki/${id}`;
      if (!nombreFiesta) continue;
      const ini = fila.ini?.value?.slice(0, 10);
      const fin = fila.fin?.value?.slice(0, 10);
      if (esFecha(ini)) {
        fiestas.push({ nombre: nombreFiesta, url, fecha: ini, ...(esFecha(fin) && fin >= ini ? { fecha_fin: fin } : {}) });
        continue;
      }
      const recurrente = fila.diaEn?.value ? mesYDia(fila.diaEn.value) : null;
      if (recurrente) fiestas.push({ nombre: nombreFiesta, url, ...recurrente });
    }
    return { q, pais, fiestas };
  }

  return {
    async ciudad(nombre) {
      const clave = claveEventos("wd", nombre);
      const enCache = await opciones.cache.obtener(clave);
      if (!esFalloDeCache(enCache) && esEntradaCache(enCache)) return enCache.ciudad;
      const ciudad = await consultar(nombre);
      await opciones.cache.guardar(clave, { ciudad });
      return ciudad;
    },
  };
}
