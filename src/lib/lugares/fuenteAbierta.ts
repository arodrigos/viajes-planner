import "server-only";
import { crearLimitador, relojReal, type Reloj } from "./limitador";
import { cacheSitiosMemoria, claveNominatim, esFalloDeCache, normalizarClaveNombre, slugDestino, type CacheSitios } from "./cacheSitios";
import { normalizarNombre } from "./normalizar";
import { FalloRedCiudad, type CajaDelimitadora, type CandidatoLugar, type FuenteCiudad, type FuenteLugares } from "./tipos";
import { VERSION_RESOLUTOR_ACTUAL } from "./ciudad";

// lug-ac3: identifica la APLICACIÓN y el repo, nunca a Adrián ni a la
// familia. La versión viene del propio package.json en build; en local o
// en un entorno sin esa variable cae a "0.0.0", que sigue siendo un UA
// válido y honesto (no inventa un número).
// Exportado para que fotos.ts use el mismo User-Agent honesto (fot-ac4
// exige "el mismo User-Agent" que el resto de las fuentes abiertas).
export function userAgent(): string {
  const version = process.env.npm_package_version ?? "0.0.0";
  return `viajes-planner/${version} (+https://github.com/arodrigos/viajes-planner)`;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const WIKIPEDIA_SEARCH_URL = "https://es.wikipedia.org/w/api.php";

export interface OpcionesFuenteAbierta {
  fetch?: typeof fetch;
  reloj?: Reloj;
  cache?: CacheSitios;
  intervaloMinMs?: number;
}

interface ResultadoNominatim {
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  category?: string;
  class?: string;
  type: string;
  name?: string;
  display_name: string;
  namedetails?: Record<string, string>;
  extratags?: Record<string, string>;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state_district?: string;
    county?: string;
    borough?: string;
    city_district?: string;
    suburb?: string;
    state?: string;
    region?: string;
  };
  boundingbox: [string, string, string, string];
}

function aCandidatoNominatim(r: ResultadoNominatim): CandidatoLugar {
  const nombresAlternativos = Object.entries(r.namedetails ?? {})
    .filter(([clave]) => clave.startsWith("name") || clave === "alt_name" || clave === "official_name")
    .map(([, valor]) => valor);
  return {
    fuente: "osm",
    id: `osm:${r.osm_type}/${r.osm_id}`,
    url: `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`,
    nombreFuente: r.namedetails?.name ?? r.name ?? r.display_name,
    nombresAlternativos,
    lat: Number(r.lat),
    lon: Number(r.lon),
    // Nominatim llamaba a este campo "class"; las respuestas recientes lo
    // devuelven como "category" -- se acepta cualquiera de los dos.
    categoriaOsm: r.category ?? r.class,
    tipoOsm: r.type,
    etiquetas: {
      opening_hours: r.extratags?.opening_hours,
      wikipedia: r.extratags?.wikipedia,
      wikidata: r.extratags?.wikidata,
      website: r.extratags?.website,
    },
    ...(r.address ? { direccion: { ...r.address } } : {}),
  };
}

interface ResultadoBusquedaWikipedia {
  query?: {
    search?: Array<{ title: string; pageid: number }>;
  };
}

interface ResultadoCoordenadasWikipedia {
  query?: {
    pages?: Record<string, { coordinates?: Array<{ lat: number; lon: number }> }>;
  };
}

export function crearFuenteAbierta(opciones: OpcionesFuenteAbierta = {}): FuenteLugares & FuenteCiudad {
  const fetchImpl = opciones.fetch ?? fetch;
  const reloj = opciones.reloj ?? relojReal;
  const cache = opciones.cache ?? cacheSitiosMemoria();
  // El límite de ritmo cubre Nominatim; Wikipedia no tiene la misma
  // política estricta de 1 req/s, pero comparte el mismo User-Agent
  // honesto y el mismo único reintento ante 429/5xx (lug-ac3).
  const limitarNominatim = crearLimitador(opciones.intervaloMinMs ?? 1100, reloj);

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

  async function geocodificarDestino(destino: string): Promise<CajaDelimitadora | null> {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(destino)}&format=jsonv2&limit=1`;
    const respuesta = await limitarNominatim(() => peticionConReintento(url));
    if (!respuesta) return null;
    const datos = (await respuesta.json()) as ResultadoNominatim[];
    const primero = datos[0];
    if (!primero) return null;
    const [minLat, maxLat, minLon, maxLon] = primero.boundingbox.map(Number);
    return { minLat, maxLat, minLon, maxLon };
  }

  // bar-ac4 (feedback del gatekeeper, 2026-10-04): un fallo de red (429/5xx
  // persistente o excepción) NO es una respuesta negativa legítima y no se
  // cachea -- lanzar FalloRedCiudad hace que resolverNombre deje la parada
  // en `error` (se reintenta en el siguiente tick) en vez de en
  // `no-resuelta` (congelada 30 días). Mismo trato que ya tenían
  // buscarLibre y geocodificarCiudad; reutiliza la misma clase porque el
  // significado es idéntico: "no se pudo preguntar", no "ciudad".
  async function buscarNominatim(nombre: string, cualificador: string, bbox: CajaDelimitadora): Promise<CandidatoLugar[]> {
    const clave = claveNominatim(slugDestino(cualificador), normalizarClaveNombre(nombre));
    const enCache = await cache.obtener(clave);
    if (!esFalloDeCache(enCache)) return enCache as CandidatoLugar[];

    // viewbox = izquierda,arriba,derecha,abajo (lon_min,lat_max,lon_max,lat_min).
    const viewbox = `${bbox.minLon},${bbox.maxLat},${bbox.maxLon},${bbox.minLat}`;
    const url =
      `${NOMINATIM_URL}?q=${encodeURIComponent(`${nombre}, ${cualificador}`)}&format=jsonv2&limit=5` +
      `&viewbox=${viewbox}&bounded=1&extratags=1&namedetails=1&addressdetails=1&accept-language=es`;
    const respuesta = await limitarNominatim(() => peticionConReintento(url));
    if (!respuesta) throw new FalloRedCiudad(`no se pudo buscar «${nombre}, ${cualificador}»`);
    const candidatos = ((await respuesta.json()) as ResultadoNominatim[]).map(aCandidatoNominatim);
    await cache.guardar(clave, candidatos);
    return candidatos;
  }

  // bbox no acota la búsqueda en Wikipedia (su API de búsqueda de texto no
  // acepta una caja): el filtrado por el cualificador lo hace evaluarCandidato
  // después, con las coordenadas que sí trae cada resultado.
  async function buscarWikipedia(nombre: string, cualificador: string): Promise<CandidatoLugar[]> {
    const clave = `wikipedia:${slugDestino(cualificador)}:${normalizarClaveNombre(nombre)}`;
    const enCache = await cache.obtener(clave);
    if (!esFalloDeCache(enCache)) return enCache as CandidatoLugar[];

    const urlBusqueda =
      `${WIKIPEDIA_SEARCH_URL}?action=query&list=search&format=json&srsearch=${encodeURIComponent(`${nombre} ${cualificador}`)}&srlimit=3`;
    const respuestaBusqueda = await peticionConReintento(urlBusqueda);
    const resultadosBusqueda = respuestaBusqueda ? ((await respuestaBusqueda.json()) as ResultadoBusquedaWikipedia) : null;
    const titulos = resultadosBusqueda?.query?.search?.map((r) => r.title) ?? [];
    if (titulos.length === 0) {
      await cache.guardar(clave, []);
      return [];
    }

    const urlCoordenadas =
      `${WIKIPEDIA_SEARCH_URL}?action=query&prop=coordinates&format=json&titles=${encodeURIComponent(titulos.join("|"))}`;
    const respuestaCoordenadas = await peticionConReintento(urlCoordenadas);
    const datosCoordenadas = respuestaCoordenadas ? ((await respuestaCoordenadas.json()) as ResultadoCoordenadasWikipedia) : null;
    const paginas = Object.values(datosCoordenadas?.query?.pages ?? {});

    const candidatos: CandidatoLugar[] = [];
    titulos.forEach((titulo, indice) => {
      const coordenadas = paginas[indice]?.coordinates?.[0];
      if (!coordenadas) return;
      candidatos.push({
        fuente: "wikipedia",
        id: `wikipedia:es:${titulo}`,
        url: `https://es.wikipedia.org/wiki/${encodeURIComponent(titulo.replace(/ /g, "_"))}`,
        nombreFuente: titulo,
        nombresAlternativos: [],
        lat: coordenadas.lat,
        lon: coordenadas.lon,
        etiquetas: {},
      });
    });
    await cache.guardar(clave, candidatos);
    return candidatos;
  }

  // ciu-ac1/ciu-ac2: búsqueda libre, sin viewbox -- se usa para deducir la
  // ciudad por las paradas cuando la del destino no resolvió nada.
  // ciu-ac7: un fallo de red (reintentado y agotado) lanza FalloRedCiudad
  // en vez de devolver [] -- [] es una respuesta negativa legítima
  // (Nominatim contestó "no hay nada"), que es una conclusión muy distinta
  // de "no se pudo preguntar".
  async function buscarLibre(nombre: string): Promise<CandidatoLugar[]> {
    // bar-ac4 (feedback del gatekeeper, 2026-10-04): la clave de caché lleva
    // la versión del resolutor -- sin esto, un reintento en la versión 4
    // podía leer el [] negativo que escribió la lógica rota de la versión 1
    // o 2, y el plan se volvía a sellar sin haber preguntado nada de verdad.
    const clave = `libre:v${VERSION_RESOLUTOR_ACTUAL}:${normalizarClaveNombre(nombre)}`;
    const enCache = await cache.obtener(clave);
    if (!esFalloDeCache(enCache)) return enCache as CandidatoLugar[];

    const url =
      `${NOMINATIM_URL}?q=${encodeURIComponent(nombre)}&format=jsonv2&limit=3` +
      `&addressdetails=1&accept-language=es`;
    const respuesta = await limitarNominatim(() => peticionConReintento(url));
    if (!respuesta) throw new FalloRedCiudad(`no se pudo buscar libremente «${nombre}»`);
    const candidatos = ((await respuesta.json()) as ResultadoNominatim[]).map(aCandidatoNominatim);
    await cache.guardar(clave, candidatos);
    return candidatos;
  }

  // ciu-ac2: la caja de un candidato a ciudad, para la verificación
  // geográfica del nivel que gana la votación (span y contención de las
  // paradas votantes). Mismo trato de fallo de red que buscarLibre.
  async function geocodificarCiudad(nombre: string): Promise<CajaDelimitadora | null> {
    // bar-ac4: misma razón que en buscarLibre -- la clave lleva la versión
    // del resolutor para que un reintento en una versión nueva no lea un
    // null cacheado por la lógica de una versión anterior.
    const clave = `ciudad:v${VERSION_RESOLUTOR_ACTUAL}:${normalizarClaveNombre(nombre)}`;
    const enCache = await cache.obtener(clave);
    if (!esFalloDeCache(enCache)) return enCache as CajaDelimitadora | null;

    // bar-ac4: alineado con buscarLibre -- sin accept-language=es, Nominatim
    // podía devolver un nombre en otro idioma que luego no empataba con el
    // texto del destino al verificar la caja.
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(nombre)}&format=jsonv2&limit=1&featureType=settlement&accept-language=es`;
    const respuesta = await limitarNominatim(() => peticionConReintento(url));
    if (!respuesta) throw new FalloRedCiudad(`no se pudo geocodificar la ciudad candidata «${nombre}»`);
    const datos = (await respuesta.json()) as ResultadoNominatim[];
    const primero = datos[0];
    const resultado = primero
      ? { minLat: Number(primero.boundingbox[0]), maxLat: Number(primero.boundingbox[1]), minLon: Number(primero.boundingbox[2]), maxLon: Number(primero.boundingbox[3]) }
      : null;
    await cache.guardar(clave, resultado);
    return resultado;
  }

  return { geocodificarDestino, buscarNominatim, buscarWikipedia, buscarLibre, geocodificarCiudad };
}

// Expuesto para que resolverPlan y los tests puedan derivar la clave de
// caché exactamente como aquí (un solo sitio que normaliza).
export { normalizarNombre };
