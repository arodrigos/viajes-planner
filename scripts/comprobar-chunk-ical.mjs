// imp-ac9: ical.js solo puede viajar en un chunk diferido del cliente. Tras
// `next build` se comprueba que:
//  1. la firma de ical.js está en algún chunk de cliente (si no, el import
//     dinámico se ha perdido y la importación no funcionaría);
//  2. ningún chunk inicial de /plan/[id] la lleva;
//  3. en el servidor solo existe su chunk propio (Turbopack emite una copia SSR
//     de todo import() de un componente cliente, que nunca se ejecuta): no puede
//     estar mezclada en una ruta de API ni en otro módulo.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Cadena propia de ical.js (el parser de vCard 3), ajena al resto del producto.
export const FIRMA_ICAL = "vcard3";

function js(carpeta) {
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta, { recursive: true })
    .map((f) => path.join(carpeta, String(f)))
    .filter((f) => f.endsWith(".js") && statSync(f).isFile());
}

const lleva = (f) => readFileSync(f, "utf8").includes(FIRMA_ICAL);

export function comprobarChunkIcal(next) {
  const fallos = [];
  const cliente = js(path.join(next, "static")).filter(lleva);
  if (cliente.length === 0) fallos.push("ical.js no está en ningún chunk de cliente: el import dinámico se ha perdido");

  const manifiesto = path.join(next, "server/app/plan/[id]/page_client-reference-manifest.js");
  if (!existsSync(manifiesto)) fallos.push("falta el manifiesto de /plan/[id]: ¿se ha hecho el build?");
  else {
    const iniciales = new Set(
      [...readFileSync(manifiesto, "utf8").matchAll(/"(static\/chunks\/[^"]+\.js)"/g)]
        .map((m) => m[1])
        .filter((f, _i, todos) => todos.includes(f)),
    );
    const entrada = /"entryJSFiles":(\{.*?\}\})/s.exec(readFileSync(manifiesto, "utf8"));
    const deLaPagina = new Set(entrada ? [...entrada[1].matchAll(/"(static\/chunks\/[^"]+\.js)"/g)].map((m) => m[1]) : iniciales);
    for (const f of deLaPagina) if (existsSync(path.join(next, f)) && lleva(path.join(next, f))) fallos.push(`ical.js va en un chunk inicial de /plan/[id]: ${f}`);
  }

  for (const f of js(path.join(next, "server")).filter(lleva)) {
    if (!/node_modules_ical_js_dist_ical/.test(path.basename(f))) fallos.push(`ical.js mezclado en un módulo de servidor: ${path.relative(next, f)}`);
  }
  return fallos;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fallos = comprobarChunkIcal(process.argv[2] ?? ".next");
  if (fallos.length) {
    console.error(`ical.js fuera de su chunk diferido:\n- ${fallos.join("\n- ")}`);
    process.exit(1);
  }
  console.log("ical.js solo va en un chunk diferido de cliente");
}
