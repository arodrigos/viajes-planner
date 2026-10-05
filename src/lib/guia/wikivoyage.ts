import "server-only";
import { claveGuia, type CacheSitios, esFalloDeCache } from "@/lib/lugares/cacheSitios";
import { userAgent } from "@/lib/lugares/fuenteAbierta";
import { relojReal, type Reloj } from "@/lib/lugares/limitador";
import { extraerFichas, type FichaGuia } from "./wikitexto";

// gui-ac3: Wikimedia pide ritmo prudente por API. Una página cada 30 s es
// holgado a propósito: la guía es un adorno de la tarjeta, no merece que nos
// limiten la IP que también usa Nominatim.
export const INTERVALO_MIN_MS = 30_000;
export const IDIOMAS = ["es", "en"] as const;
export type IdiomaGuia = (typeof IDIOMAS)[number];

export interface PaginaGuia {
  idioma: IdiomaGuia;
  titulo: string;
  url: string;
  fichas: FichaGuia[];
}

// La fuente no respondió (red, 429, 5xx): no es «no hay guía», así que no se
// cachea ni se marca el intento.
export class FalloFuenteGuia extends Error {}
// Esperar al siguiente hueco de ritmo no cabe en lo que queda del tick: se
// vuelve a intentar en el siguiente, sin dar el intento por gastado.
export class EsperaExcedida extends Error {}

export interface FuenteGuia {
  // Primero es.wikivoyage; si no tiene fichas, en.wikivoyage. `hasta` es un
  // instante absoluto (ms del reloj inyectado) del que no se debe pasar.
  paginaCiudad(ciudad: string, hasta?: number): Promise<PaginaGuia | null>;
}

export interface OpcionesFuenteGuia {
  fetch?: typeof fetch;
  reloj?: Reloj;
  cache: CacheSitios;
}

interface RespuestaMediaWiki {
  query?: { pages?: Array<{ title?: string; missing?: boolean; revisions?: Array<{ slots?: { main?: { content?: string } } }> }> };
}

interface EntradaCache {
  pagina: { titulo: string; fichas: FichaGuia[] } | null;
}

function esEntradaCache(valor: unknown): valor is EntradaCache {
  return typeof valor === "object" && valor !== null && "pagina" in valor;
}

export function urlPagina(idioma: IdiomaGuia, titulo: string): string {
  return `https://${idioma}.wikivoyage.org/wiki/${encodeURIComponent(titulo.replace(/ /g, "_"))}`;
}

export function crearFuenteGuiaAbierta(opciones: OpcionesFuenteGuia): FuenteGuia {
  const fetchImpl = opciones.fetch ?? fetch;
  const reloj = opciones.reloj ?? relojReal;
  let ultimaPeticion = -Infinity;

  async function pedir(idioma: IdiomaGuia, ciudad: string, hasta: number | undefined): Promise<EntradaCache> {
    const espera = Math.max(0, ultimaPeticion + INTERVALO_MIN_MS - reloj.ahora());
    if (espera > 0) {
      if (hasta !== undefined && reloj.ahora() + espera > hasta) throw new EsperaExcedida();
      await reloj.dormir(espera);
    }
    ultimaPeticion = reloj.ahora();

    // Hacia fuera solo sale el nombre de la ciudad.
    const parametros = new URLSearchParams({
      action: "query",
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
      redirects: "1",
      format: "json",
      formatversion: "2",
      titles: ciudad,
    });
    let respuesta: Response;
    try {
      respuesta = await fetchImpl(`https://${idioma}.wikivoyage.org/w/api.php?${parametros}`, {
        headers: { "User-Agent": userAgent() },
      });
    } catch {
      throw new FalloFuenteGuia("red");
    }
    if (!respuesta.ok) throw new FalloFuenteGuia(`HTTP ${respuesta.status}`);
    let datos: RespuestaMediaWiki;
    try {
      datos = (await respuesta.json()) as RespuestaMediaWiki;
    } catch {
      throw new FalloFuenteGuia("respuesta sin JSON");
    }
    const pagina = datos.query?.pages?.[0];
    const contenido = pagina?.revisions?.[0]?.slots?.main?.content;
    if (!pagina || pagina.missing || typeof contenido !== "string" || typeof pagina.title !== "string") return { pagina: null };
    const fichas = extraerFichas(contenido);
    return { pagina: fichas.length > 0 ? { titulo: pagina.title, fichas } : null };
  }

  return {
    async paginaCiudad(ciudad, hasta) {
      for (const idioma of IDIOMAS) {
        const clave = claveGuia(idioma, ciudad);
        const enCache = await opciones.cache.obtener(clave);
        let entrada: EntradaCache;
        if (!esFalloDeCache(enCache) && esEntradaCache(enCache)) entrada = enCache;
        else {
          entrada = await pedir(idioma, ciudad, hasta);
          await opciones.cache.guardar(clave, entrada);
        }
        if (entrada.pagina) {
          return { idioma, titulo: entrada.pagina.titulo, url: urlPagina(idioma, entrada.pagina.titulo), fichas: entrada.pagina.fichas };
        }
      }
      return null;
    },
  };
}
