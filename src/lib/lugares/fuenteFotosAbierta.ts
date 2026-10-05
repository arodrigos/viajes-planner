import "server-only";
import { relojReal, type Reloj } from "./limitador";
import { userAgent } from "./fuenteAbierta";
import type { CandidatoGeosearch, FuenteFotos, ResumenPaginaWikipedia } from "./tipos";
import type { Foto } from "@/lib/plan/tipos";
import { esUrlFotoValida, licenciaUrlSegura, normalizarUrlFoto } from "./urlFoto";

// fot-ac1: lista blanca de licencias -- se compara contra LicenseShortName
// tal cual lo devuelve Commons (p. ej. "CC BY-SA 4.0", "CC0 1.0", "Public
// domain"). Cualquier otra cosa (sin licencia libre, "All rights
// reserved", etc.) deja la parada sin foto.
const LICENCIA_PERMITIDA = /^(cc0(\s\d(\.\d)?)?|public domain|cc by(-sa)?\s\d(\.\d)?)$/i;

const RADIO_GEOSEARCH_M = 150;
const ANCHO_MINIATURA_PX = 640;

export interface OpcionesFuenteFotosAbierta {
  fetch?: typeof fetch;
  reloj?: Reloj;
}

function limpiarHtml(valor: string): string {
  return valor.replace(/<[^>]*>/g, "").trim();
}

interface RespuestaResumenWikipedia {
  originalimage?: { source: string };
  extract?: string;
}

// El CDN de Wikimedia sirve "originalimage" a veces directo
// (".../commons/4/4c/Fichero.jpg") y a veces a través de su servicio de
// miniaturas (".../thumb/.../4/4c/Fichero.jpg/3840px-Fichero.jpg?utm_...");
// en ambos casos el nombre real del fichero es el último segmento de la
// ruta, sin el prefijo "NNNNpx-" del tamaño ni la cadena de consulta.
function ficheroDesdeUrlImagen(url: string): string | undefined {
  const sinConsulta = url.split("?")[0];
  const ultimoSegmento = sinConsulta.split("/").pop();
  if (!ultimoSegmento) return undefined;
  const sinPrefijoDeTamano = ultimoSegmento.replace(/^\d+px-/, "");
  return decodeURIComponent(sinPrefijoDeTamano);
}

interface RespuestaImageinfoCommons {
  query?: {
    pages?: Record<
      string,
      {
        imageinfo?: Array<{
          url: string;
          thumburl?: string;
          extmetadata?: Record<string, { value: string }>;
        }>;
      }
    >;
  };
}

interface RespuestaGeosearchWikipedia {
  query?: { geosearch?: Array<{ title: string }> };
}

// fot-ac2/fot-ac4: mismo User-Agent honesto y mismo único reintento ante
// 429/5xx que fuenteAbierta.ts (lug-ac3) -- Wikipedia/Commons no tienen la
// política estricta de 1 req/s de Nominatim, así que no hay limitador de
// ritmo aquí, solo la disciplina de identificarse y no insistir más de una
// vez.
export function crearFuenteFotosAbierta(opciones: OpcionesFuenteFotosAbierta = {}): FuenteFotos {
  const fetchImpl = opciones.fetch ?? fetch;
  const reloj = opciones.reloj ?? relojReal;

  async function peticionConReintento(url: string): Promise<Response | null> {
    const hacer = () => fetchImpl(url, { headers: { "User-Agent": userAgent() } });
    try {
      let respuesta = await hacer();
      if (respuesta.status === 429 || respuesta.status >= 500) {
        await reloj.dormir(30_000);
        respuesta = await hacer();
      }
      return respuesta.ok ? respuesta : null;
    } catch {
      return null;
    }
  }

  return {
    async resumenPagina(lang, titulo): Promise<ResumenPaginaWikipedia | null> {
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titulo.replace(/ /g, "_"))}`;
      const respuesta = await peticionConReintento(url);
      if (!respuesta) return null;
      const datos = (await respuesta.json()) as RespuestaResumenWikipedia;
      const fichero = datos.originalimage ? ficheroDesdeUrlImagen(datos.originalimage.source) : undefined;
      return { fichero, ...(typeof datos.extract === "string" && datos.extract ? { extracto: datos.extract } : {}) };
    },

    async infoImagen(fichero): Promise<Foto | null> {
      const url =
        `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url%7Cextmetadata` +
        `&iiurlwidth=${ANCHO_MINIATURA_PX}&titles=${encodeURIComponent(`File:${fichero}`)}&format=json`;
      const respuesta = await peticionConReintento(url);
      if (!respuesta) return null;
      const datos = (await respuesta.json()) as RespuestaImageinfoCommons;
      const info = Object.values(datos.query?.pages ?? {})[0]?.imageinfo?.[0];
      if (!info) return null;

      const licencia = info.extmetadata?.LicenseShortName?.value?.trim();
      if (!licencia || !LICENCIA_PERMITIDA.test(licencia)) return null;

      // alc-ac5: una URL fuera del CDN de Wikimedia deja la foto sin guardar.
      const urlFoto = normalizarUrlFoto(info.thumburl ?? info.url);
      if (!esUrlFotoValida(urlFoto)) return null;

      const ficheroNormalizado = fichero.replace(/ /g, "_");
      return {
        url: urlFoto,
        fichero,
        autor: limpiarHtml(info.extmetadata?.Artist?.value ?? "Wikimedia Commons"),
        licencia,
        licencia_url: licenciaUrlSegura(info.extmetadata?.LicenseUrl?.value),
        pagina_url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(ficheroNormalizado)}`,
        fuente: "commons",
      };
    },

    async geosearch(lat, lon): Promise<CandidatoGeosearch[]> {
      const url =
        `https://es.wikipedia.org/w/api.php?action=query&list=geosearch&format=json` +
        `&gscoord=${lat}%7C${lon}&gsradius=${RADIO_GEOSEARCH_M}&gslimit=5`;
      const respuesta = await peticionConReintento(url);
      if (!respuesta) return [];
      const datos = (await respuesta.json()) as RespuestaGeosearchWikipedia;
      return (datos.query?.geosearch ?? []).map((resultado) => ({ lang: "es", titulo: resultado.title }));
    },
  };
}
