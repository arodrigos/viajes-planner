/// <reference lib="webworker" />
import { Serwist } from "serwist";
import type { PrecacheEntry } from "serwist";

declare const self: ServiceWorkerGlobalScope & { __SW_MANIFEST: (PrecacheEntry | string)[] | undefined };
// Lo sustituye esbuild al construir (serwist.config.mjs).
declare const __COMMIT_BUILD__: string;

// Sin defaultCache a propósito: guardaría GET de /api/* y recursos de
// terceros (Google incluido). En este bloque el SW solo sirve su precache;
// cualquier otra petición va a red sin tocarla.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [],
});

// El único mensaje que el SW contesta: permite comprobar qué build controla
// la página comparándolo con el commit de /api/salud.
self.addEventListener("message", (evento) => {
  if (evento.data?.tipo === "version") evento.ports[0]?.postMessage({ commit: __COMMIT_BUILD__ });
});

serwist.addEventListeners();
