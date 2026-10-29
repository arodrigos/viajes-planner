// Mide lo que pesa el despliegue de Vercel a partir del trazado de `next build`
// (.next/server/**/*.nft.json): cada ruta es una función con sus ficheros
// trazados. Sirve para comparar antes y después de tocar el empaquetado.
// El informe solo lleva nombres de ruta, de paquete y tamaños: nunca lee
// variables de entorno ni vuelca el contenido de los ficheros.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MB = 1024 * 1024;
const redondear = (n) => Math.round(n * 100) / 100;

function buscarNft(dir, acumulado = []) {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) buscarNft(ruta, acumulado);
    else if (entrada.name.endsWith(".nft.json")) acumulado.push(ruta);
  }
  return acumulado;
}

// Paquete al que pertenece un fichero: el último segmento node_modules/<pkg>
// (con scope), que es el que Vercel empaqueta aunque esté anidado.
function paqueteDe(fichero) {
  const partes = fichero.split(path.sep);
  const i = partes.lastIndexOf("node_modules");
  if (i === -1 || !partes[i + 1]) return null;
  return partes[i + 1].startsWith("@") ? `${partes[i + 1]}/${partes[i + 2]}` : partes[i + 1];
}

export function medirDespliegue(raiz, commit = "desconocido") {
  const server = path.join(raiz, ".next", "server");
  if (!existsSync(server)) {
    throw new Error("No hay build: ejecuta `next build` antes de medir el despliegue.");
  }
  const tamanos = new Map(); // fichero absoluto -> bytes, para no contar dos veces
  const tamano = (f) => {
    if (!tamanos.has(f)) {
      try {
        tamanos.set(f, statSync(f).size);
      } catch {
        tamanos.set(f, 0); // fichero trazado que ya no existe: no pesa
      }
    }
    return tamanos.get(f);
  };

  const porFuncion = [];
  const ficherosUnicos = new Set();
  for (const nft of buscarNft(server).sort()) {
    const { files } = JSON.parse(readFileSync(nft, "utf8"));
    const absolutos = [...new Set(files.map((f) => path.resolve(path.dirname(nft), f)))].sort();
    absolutos.forEach((f) => ficherosUnicos.add(f));
    const bytes = absolutos.reduce((suma, f) => suma + tamano(f), 0);
    const huella = createHash("sha256")
      .update(absolutos.map((f) => path.relative(raiz, f)).join("\n"))
      .digest("hex")
      .slice(0, 12);
    porFuncion.push({
      ruta: path.relative(server, nft).replace(/\.nft\.json$/, "").split(path.sep).join("/"),
      mb: redondear(bytes / MB),
      digest: huella,
    });
  }

  const porPaquete = new Map();
  for (const f of ficherosUnicos) {
    const pkg = paqueteDe(f);
    if (pkg) porPaquete.set(pkg, (porPaquete.get(pkg) ?? 0) + tamano(f));
  }
  const mayores = [...porPaquete]
    .map(([nombre, bytes]) => ({ nombre, mb: redondear(bytes / MB) }))
    .sort((a, b) => b.mb - a.mb)
    .slice(0, 15);

  return {
    commit,
    funciones: porFuncion.length,
    digests_distintos: new Set(porFuncion.map((f) => f.digest)).size,
    total_mb: redondear(porFuncion.reduce((suma, f) => suma + f.mb, 0)),
    por_funcion: porFuncion,
    mayores_dependencias: mayores,
  };
}

function commitActual(raiz) {
  const deEntorno = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.COMMIT_SHA;
  if (deEntorno) return deEntorno;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: raiz, encoding: "utf8" }).trim();
  } catch {
    return "desconocido";
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valor = (nombre) => (args.includes(nombre) ? args[args.indexOf(nombre) + 1] : undefined);
  const raiz = path.resolve(valor("--raiz") ?? process.cwd());
  try {
    const informe = medirDespliegue(raiz, commitActual(raiz));
    const json = `${JSON.stringify(informe, null, 2)}\n`;
    const salida = valor("--salida");
    if (salida) writeFileSync(salida, json);
    else process.stdout.write(json);
    console.error(`${informe.funciones} funciones, ${informe.digests_distintos} digests, ${informe.total_mb} MB`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
