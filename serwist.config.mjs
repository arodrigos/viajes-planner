// Modo configurador de Serwist (decisión de diseño pwa-ac2): `next build`
// sigue con Turbopack y este paso genera después public/sw.js como fichero
// estático. No hay route handler de Serwist, así que no aplica el fallo de
// @serwist/turbopack en Vercel.
import { serwist } from "@serwist/next/config";

// Mismo orden que commitDesplegado() en src/lib/salud.ts: el SW responde con
// el commit que /api/salud declara en el mismo despliegue.
const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.COMMIT_SHA ?? "0".repeat(40);

export default serwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Los documentos de la app dependen de la sesión: nunca se precachean.
  precachePrerendered: false,
  // Los iconos y el worker de maplibre ya entran por el glob de public/ con su
  // hash: repetirlos con otra revisión haría fallar la precache en el cliente
  // (entradas en conflicto). El manifiesto es una ruta de Next, no un fichero.
  additionalPrecacheEntries: [
    { url: "/manifest.webmanifest", revision: commit },
  ],
  esbuildOptions: { define: { __COMMIT_BUILD__: JSON.stringify(commit) } },
});
