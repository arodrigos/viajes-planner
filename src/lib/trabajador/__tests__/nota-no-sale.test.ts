import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { promptCuriosidades } from "@/lib/guia/promptCuriosidades";

const RAIZ = join(__dirname, "..", "..");

function fuentes(carpeta: string): string[] {
  return readdirSync(join(RAIZ, carpeta), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => join(RAIZ, carpeta, e.name));
}

// spd-ac6: la nota es privada del usuario. Ni la búsqueda del trabajador ni la
// guía la leen: si algún `select` empieza a traer `nota` (o `*` sobre paradas),
// este test avisa antes de que llegue a un prompt o a una petición externa.
describe("la nota de un sitio propio no sale (spd-ac6)", () => {
  it("ningún select del trabajador ni de la guía pide nota ni *", () => {
    const sospechosos: string[] = [];
    for (const fichero of [...fuentes("trabajador"), ...fuentes("guia"), ...fuentes("lugares")]) {
      const texto = readFileSync(fichero, "utf8");
      for (const m of texto.matchAll(/\.select\(\s*(["'`])([^"'`]*)\1/g)) {
        if (/\bnota\b/.test(m[2]) || (m[2].trim() === "*" && /from\(\s*["']paradas["']\s*\)\s*\.select/.test(texto.slice(Math.max(0, m.index - 40), m.index + m[0].length)))) {
          sospechosos.push(`${fichero}: ${m[2]}`);
        }
      }
      expect(/COLUMNAS_PARADA/.test(texto), `${fichero} usa COLUMNAS_PARADA`).toBe(false);
    }
    expect(sospechosos).toEqual([]);
  });

  it("el prompt de curiosidades solo lleva el nombre del sitio, nunca la nota (propiedad)", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Z0-9]{12,20}$/), (nota) => {
        const prompt = promptCuriosidades([
          { clave: "s1", datos: { sitio: { id: "x", tipo: "parada", nombre: "Casa Fassi" }, candidatas: [] } },
        ]);
        return !prompt.includes(nota);
      }),
      { numRuns: 50 },
    );
  });
});
