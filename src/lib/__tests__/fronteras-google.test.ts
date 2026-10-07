import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function ficheros(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? (nombre === "__tests__" ? [] : ficheros(ruta)) : [ruta];
  });
}

// cas-ac3: nada de Google puede llegar a lo que se le da al modelo; los
// términos prohíben usar su contenido como entrada de otro modelo.
describe("fronteras de Google", () => {
  it("ningún fichero de src/lib/guia ni los prompts del trabajador importan código de Google", () => {
    const candidatos = [...ficheros("src/lib/guia"), "src/lib/trabajador/prompt.ts", "src/lib/trabajador/invocacion.ts"];
    const infractores = candidatos.filter((ruta) => /from\s+["'](@\/lib\/google|@\/lib\/trabajador\/google|(\.\.?\/)+google)/.test(readFileSync(ruta, "utf8")));
    expect(infractores).toEqual([]);
  });

  it("casar.ts solo escribe las cuatro columnas permitidas", () => {
    const fuente = readFileSync("src/lib/trabajador/google/casar.ts", "utf8");
    const interfaz = /export interface FilaLugarGoogle \{([^}]*)\}/.exec(fuente)?.[1] ?? "";
    const claves = [...interfaz.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
    expect(claves).toEqual(["clave", "comprobado_en", "estado", "place_id"]);
  });
});
