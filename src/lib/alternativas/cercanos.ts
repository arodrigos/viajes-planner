// alt-ac4: complemento sin modelo cuando a una parada le faltan
// alternativas equivalentes. El QL se construye EXCLUSIVAMENTE desde esta
// tabla cerrada y de números (lat, lon, radio) -- el nombre de la parada
// nunca entra en la consulta, así que no hay inyección posible de Overpass
// QL a partir de texto que origina el modelo.
import "server-only";
import type { CategoriaParada } from "@/lib/plan/tipos";
import { userAgent } from "@/lib/lugares/fuenteAbierta";
import { crearLimitador, relojReal, type Reloj } from "@/lib/lugares/limitador";
import { cacheSitiosMemoria, esFalloDeCache, type CacheSitios } from "@/lib/lugares/cacheSitios";

// Un único tag (o par tag=valor) de OSM por categoría -- lo bastante
// específico para no devolver ruido, lo bastante abierto para tener
// candidatos reales. "otro" no tiene complemento: sin un tag concreto que
// la represente, Overpass solo podría dar ruido.
export const ETIQUETA_OSM_POR_CATEGORIA: Partial<Record<CategoriaParada, string>> = {
  monumento: "historic",
  museo: "tourism=museum",
  parque: "leisure=park",
  mirador: "tourism=viewpoint",
  barrio: "place=suburb",
  plaza: "place=square",
  mercado: "amenity=marketplace",
  playa: "natural=beach",
  naturaleza: "leisure=nature_reserve",
  "ocio-infantil": "leisure=playground",
  espectaculo: "amenity=theatre",
  comida: "amenity=restaurant",
  compras: "shop",
};

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const RADIO_M = 1500;

export function construirConsultaOverpass(categoria: CategoriaParada, lat: number, lon: number, radioM = RADIO_M): string | null {
  const etiqueta = ETIQUETA_OSM_POR_CATEGORIA[categoria];
  if (!etiqueta) return null;
  return `[out:json];\nnwr[${etiqueta}](around:${radioM},${lat},${lon});\nout center tags 5;`;
}

export interface CandidatoCercano {
  id: string;
  nombre: string;
  lat: number;
  lon: number;
}

export interface FuenteCercanos {
  buscar(categoria: CategoriaParada, lat: number, lon: number, radioM?: number): Promise<CandidatoCercano[]>;
}

interface ElementoOverpass {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface RespuestaOverpass {
  elements?: ElementoOverpass[];
}

function claveCache(categoria: CategoriaParada, lat: number, lon: number, radioM: number): string {
  return `overpass:${categoria}:${lat.toFixed(3)}:${lon.toFixed(3)}:${radioM}`;
}

export interface OpcionesFuenteCercanos {
  fetch?: typeof fetch;
  reloj?: Reloj;
  cache?: CacheSitios;
  intervaloMinMs?: number;
}

// alt-ac4: mismo User-Agent honesto, mismo único reintento tras 30 s ante
// 429/5xx, y caché obligatoria (misma política de uso justa que
// lug-ac3 exige a cualquier instancia pública de OSM) -- un segundo
// `buscar` con las mismas coordenadas redondeadas y la misma categoría no
// repite la petición.
export function crearFuenteCercanosAbierta(opciones: OpcionesFuenteCercanos = {}): FuenteCercanos {
  const fetchImpl = opciones.fetch ?? fetch;
  const reloj = opciones.reloj ?? relojReal;
  const cache = opciones.cache ?? cacheSitiosMemoria();
  const limitar = crearLimitador(opciones.intervaloMinMs ?? 1100, reloj);

  async function peticionConReintento(consulta: string): Promise<Response | null> {
    const hacer = () =>
      fetchImpl(OVERPASS_URL, {
        method: "POST",
        headers: { "User-Agent": userAgent(), "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(consulta)}`,
      });
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
    async buscar(categoria, lat, lon, radioM = RADIO_M): Promise<CandidatoCercano[]> {
      const consulta = construirConsultaOverpass(categoria, lat, lon, radioM);
      if (!consulta) return [];

      const clave = claveCache(categoria, lat, lon, radioM);
      const enCache = await cache.obtener(clave);
      if (!esFalloDeCache(enCache)) return enCache as CandidatoCercano[];

      const respuesta = await limitar(() => peticionConReintento(consulta));
      if (!respuesta) {
        await cache.guardar(clave, []);
        return [];
      }
      const datos = (await respuesta.json()) as RespuestaOverpass;
      const candidatos = (datos.elements ?? [])
        .map((elemento) => {
          const nombre = elemento.tags?.name;
          const latC = elemento.lat ?? elemento.center?.lat;
          const lonC = elemento.lon ?? elemento.center?.lon;
          if (!nombre || latC === undefined || lonC === undefined) return null;
          return { id: `osm:${elemento.type}/${elemento.id}`, nombre, lat: latC, lon: lonC };
        })
        .filter((c): c is CandidatoCercano => c !== null);

      await cache.guardar(clave, candidatos);
      return candidatos;
    },
  };
}
