/// <reference lib="webworker" />
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist } from "serwist";
import type { PrecacheEntry, RuntimeCaching, SerwistPlugin } from "serwist";
import {
  CABECERA_COPIA,
  CABECERA_LEIDO_EN,
  CACHE_DATOS,
  CACHE_FOTOS,
  LIMITE_RED_MS,
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
