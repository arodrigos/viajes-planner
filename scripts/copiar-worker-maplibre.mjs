// map-ac1: Next.js (Turbopack y también `next build --webpack`) es la
// excepción que el propio proyecto MapLibre documenta para el patrón
// `new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url)`: el
// bundler no emite el fichero hermano `maplibre-gl-shared.mjs` junto al
// worker, que falla en su primer `import` -el mapa monta pero nunca pide
// una tesela-. La única vía que MapLibre documenta para Next.js es servir
// el worker (y su hermano) como estáticos y llamar a `setWorkerUrl` con esa
// ruta (MapaDia.tsx). Este script copia ambos ficheros a `public/maplibre/`
// en cada `npm install`, para que siempre viajen con la versión instalada.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raizRepo = join(dirname(fileURLToPath(import.meta.url)), "..");
const origenDist = join(raizRepo, "node_modules", "maplibre-gl", "dist");
const destino = join(raizRepo, "public", "maplibre");

const FICHEROS = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

mkdirSync(destino, { recursive: true });

for (const fichero of FICHEROS) {
  const origen = join(origenDist, fichero);
  if (!existsSync(origen)) {
    throw new Error(`No se encuentra ${origen}: ¿cambió el nombre del fichero en una versión nueva de maplibre-gl?`);
  }
  copyFileSync(origen, join(destino, fichero));
}
