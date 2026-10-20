/// <reference lib="webworker" />
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist } from "serwist";
import type { PrecacheEntry, RuntimeCaching, SerwistPlugin } from "serwist";
import {
  CABECERA_COPIA,
  CABECERA_LEIDO_EN,
  CACHE_DATOS,
  CACHE_FOTOS,
  CACHE_MAPA,
  LIMITE_RED_MAPA_MS,
  LIMITE_RED_MS,
  claveMapa,
  clasificar,
  destinoSinConexion,
  esGuardable,
  type Clase,
} from "../lib/sinConexion/reglas";

declare const self: ServiceWorkerGlobalScope & { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined };
// Lo sustituye esbuild al construir (serwist.config.mjs).
declare const __COMMIT_BUILD__: string;

const DIA_S = 24 * 60 * 60;

function claseDe(peticion: Request): Clase {
  return clasificar({ url: peticion.url, metodo: peticion.method, modo: peticion.mode }, self.location.origin);
}

// Red con límite de espera y, si falla o vence, la ruta de respaldo. El
// documento de /plan o /viajes nunca se guarda: con un build nuevo apuntaría a
// chunks que la precache ya borró, y podría ser la pantalla de login de Vercel.
function conRespaldo(respaldo: (peticion: Request) => string): RuntimeCaching["handler"] {
  return {
    async handle({ request }) {
      const limite = new Promise<null>((resolver) => setTimeout(() => resolver(null), LIMITE_RED_MS));
      try {
        const respuesta = await Promise.race([fetch(request), limite]);
        if (respuesta) return respuesta;
      } catch {
        // Sin red: cae al respaldo.
      }
      return Response.redirect(new URL(respaldo(request), self.location.origin).href, 302);
    },
  };
}

// Solo lee viajes-mapa: lo escribe la página al pulsar el botón, nunca el SW,
// para que navegar no llene el almacenamiento ni descargue en bloque. Un glifo
// sin copia devuelve un PBF vacío válido (el texto de esa letra no se pinta
// pero el mapa sí) y una tesela sin copia un 404, que MapLibre trata como
// «sin datos» sin romper el resto.
const mapaConRespaldo: RuntimeCaching["handler"] = {
  async handle({ request }) {
    // El guardado pide con cache:"reload" y necesita la respuesta real, 429 y
    // fallos de red incluidos; el respaldo la taparía y se guardaría un 404.
    if (request.cache === "reload") return fetch(request);
    const limite = new Promise<null>((resolver) => setTimeout(() => resolver(null), LIMITE_RED_MAPA_MS));
    try {
      const respuesta = await Promise.race([fetch(request), limite]);
      if (respuesta?.ok) return respuesta;
      if (respuesta && respuesta.status !== 429 && respuesta.status < 500) return respuesta;
    } catch {
      // Sin red: cae a la copia.
    }
    const copia = await (await caches.open(CACHE_MAPA)).match(claveMapa(request.url));
    if (copia) return copia;
    const ruta = new URL(request.url).pathname;
    if (ruta.startsWith("/fonts/")) return new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "application/x-protobuf" } });
    return new Response(null, { status: 404 });
  },
};

const guardarSoloElPlan: SerwistPlugin = {
  cacheWillUpdate: async ({ response }) =>
    esGuardable({
      status: response.status,
      redirected: response.redirected,
      contentType: response.headers.get("content-type"),
      leidoEn: response.headers.get(CABECERA_LEIDO_EN),
    })
      ? response
      : null,
  // Marca que lo que llega a la página es la copia y no una respuesta de red.
  cachedResponseWillBeUsed: async ({ cachedResponse }) => {
    if (!cachedResponse) return cachedResponse;
    const cabeceras = new Headers(cachedResponse.headers);
    cabeceras.set(CABECERA_COPIA, "1");
    return new Response(cachedResponse.body, { status: cachedResponse.status, statusText: cachedResponse.statusText, headers: cabeceras });
  },
};

// Lista cerrada: sin defaultCache, que guardaría GET de /api/* y recursos de
// terceros (Google incluido). Lo que no case aquí no pasa por el SW.
const serwist: Serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      matcher: ({ request }) => claseDe(request) === "navegacion-sin-conexion",
      handler: {
        // La página es del build actual y vive en la precache; con otros
        // parámetros (?plan=) la precache no la casa sola.
        async handle({ request }): Promise<Response> {
          return (await serwist.matchPrecache("/sin-conexion")) ?? fetch(request);
        },
      },
    },
    { matcher: ({ request }) => claseDe(request) === "navegacion-plan", handler: conRespaldo((p) => destinoSinConexion(p.url, self.location.origin)) },
    { matcher: ({ request }) => claseDe(request) === "navegacion", handler: conRespaldo(() => "/sin-conexion") },
    {
      matcher: ({ request }) => claseDe(request) === "api-plan",
      handler: new NetworkFirst({
        cacheName: CACHE_DATOS,
        networkTimeoutSeconds: LIMITE_RED_MS / 1000,
        plugins: [guardarSoloElPlan, new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 90 * DIA_S, purgeOnQuotaError: true })],
      }),
    },
    { matcher: ({ request }) => claseDe(request) === "mapa", handler: mapaConRespaldo },
    {
      matcher: ({ request }) => claseDe(request) === "foto",
      handler: new CacheFirst({
        cacheName: CACHE_FOTOS,
        plugins: [
          { cacheWillUpdate: async ({ response }) => (response.status === 200 ? response : null) },
          new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * DIA_S, purgeOnQuotaError: true }),
        ],
      }),
    },
  ],
});

// El único mensaje que el SW contesta: permite comprobar qué build controla
// la página comparándolo con el commit de /api/salud.
self.addEventListener("message", (evento) => {
  if (evento.data?.tipo === "version") evento.ports[0]?.postMessage({ commit: __COMMIT_BUILD__ });
});

serwist.addEventListeners();
