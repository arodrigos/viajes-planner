import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Los dos parámetros existen para que el test pueda probar el script con un
// directorio y una lista temporales, sin tocar las capturas reales.
function argumento(nombre, porDefecto) {
  const i = process.argv.indexOf(nombre);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

const directorio = path.resolve(argumento("--dir", "artefactos/capturas"));
const lista = path.resolve(argumento("--lista", "src/test-utils/capturas-esperadas.ts"));

const { CAPTURAS_ESPERADAS } = await import(pathToFileURL(lista).href);

const faltan = CAPTURAS_ESPERADAS.filter(({ bloque, fichero }) => !existsSync(path.join(directorio, bloque, fichero)));
for (const { bloque, fichero } of faltan) {
  console.error(`Falta la captura declarada del bloque ${bloque}: ${fichero}`);
}
if (faltan.length > 0) process.exit(1);
console.log(`Capturas declaradas presentes: ${CAPTURAS_ESPERADAS.length}`);
