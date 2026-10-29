import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { medirDespliegue } from "../medir-despliegue.mjs";

const SCRIPT = path.resolve(import.meta.dirname, "../medir-despliegue.mjs");
const carpetas: string[] = [];

// Un build mínimo: cada función lista los ficheros que traza, con su tamaño.
function montarBuild(funciones: Record<string, string[]>, tamanos: Record<string, number>): string {
  const raiz = mkdtempSync(path.join(tmpdir(), "medir-"));
  carpetas.push(raiz);
  for (const [fichero, bytes] of Object.entries(tamanos)) {
    mkdirSync(path.dirname(path.join(raiz, fichero)), { recursive: true });
    writeFileSync(path.join(raiz, fichero), Buffer.alloc(bytes));
  }
  for (const [ruta, ficheros] of Object.entries(funciones)) {
    const nft = path.join(raiz, ".next/server/app", `${ruta}.nft.json`);
    mkdirSync(path.dirname(nft), { recursive: true });
    const relativos = ficheros.map((f) => path.relative(path.dirname(nft), path.join(raiz, f)));
    writeFileSync(nft, JSON.stringify({ version: 1, files: relativos }));
  }
  return raiz;
}

afterEach(() => {
  while (carpetas.length) rmSync(carpetas.pop()!, { recursive: true, force: true });
});

describe("medir-despliegue", () => {
  it("mide funciones, digests y dependencias mayores", () => {
    const raiz = montarBuild(
      {
        "api/a/route.js": ["node_modules/pesado/index.js", "node_modules/@x/ligero/i.js"],
        "api/b/route.js": ["node_modules/pesado/index.js", "node_modules/@x/ligero/i.js"],
        "api/c/route.js": ["node_modules/@x/ligero/i.js"],
      },
      { "node_modules/pesado/index.js": 3 * 1024 * 1024, "node_modules/@x/ligero/i.js": 1024 * 1024 },
    );
    const informe = medirDespliegue(raiz, "abc");
    expect(informe.commit).toBe("abc");
    expect(informe.funciones).toBe(3);
    expect(informe.digests_distintos).toBe(2);
    expect(informe.total_mb).toBe(9);
    expect(informe.mayores_dependencias[0]).toEqual({ nombre: "pesado", mb: 3 });
    expect(informe.mayores_dependencias[1]).toEqual({ nombre: "@x/ligero", mb: 1 });
  });

  // Invariantes de medicion-base: el total es la suma de las funciones y los
  // digests nunca superan las funciones, sea cual sea el trazado.
  it("total = suma por función y digests <= funciones, para cualquier trazado", () => {
    fc.assert(
      fc.property(
        fc.array(fc.uniqueArray(fc.integer({ min: 0, max: 5 }), { maxLength: 6 }), { minLength: 1, maxLength: 6 }),
        fc.array(fc.integer({ min: 0, max: 700_000 }), { minLength: 6, maxLength: 6 }),
        (trazados, bytes) => {
          const tamanos = Object.fromEntries(bytes.map((b, i) => [`node_modules/p${i}/f.js`, b]));
          const funciones = Object.fromEntries(
            trazados.map((t, i) => [`api/r${i}/route.js`, t.map((n) => `node_modules/p${n}/f.js`)]),
          );
          const informe = medirDespliegue(montarBuild(funciones, tamanos));
          const suma = informe.por_funcion.reduce((s: number, f: { mb: number }) => s + f.mb, 0);
          expect(Math.abs(informe.total_mb - suma)).toBeLessThanOrEqual(0.01);
          expect(informe.digests_distintos).toBeLessThanOrEqual(informe.funciones);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("sin build sale con código 1 y pide ejecutar next build", () => {
    const vacio = mkdtempSync(path.join(tmpdir(), "medir-"));
    carpetas.push(vacio);
    const r = spawnSync("node", [SCRIPT, "--raiz", vacio], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("next build");
  });

  it("escribe el informe con --salida y no filtra variables de entorno", () => {
    const raiz = montarBuild({ "api/a/route.js": ["node_modules/p/f.js"] }, { "node_modules/p/f.js": 2048 });
    const salida = path.join(raiz, "informe.json");
    const r = spawnSync("node", [SCRIPT, "--raiz", raiz, "--salida", salida], {
      encoding: "utf8",
      env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: "CENTINELA-service-role", CRON_SECRET: "CENTINELA-cron" },
    });
    expect(r.status).toBe(0);
    const todo = r.stdout + r.stderr + readFileSync(salida, "utf8");
    expect(todo).not.toContain("CENTINELA");
    expect(JSON.parse(readFileSync(salida, "utf8")).funciones).toBe(1);
  });
});
