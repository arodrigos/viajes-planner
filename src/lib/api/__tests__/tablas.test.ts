import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Un manejador que no esté en la tabla de su despachador dejaría de servirse (404) sin que el build lo note.
const api = path.join(import.meta.dirname, "../../../app/api");
const manejadores = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? manejadores(p) : e.name === "manejador.ts" ? [path.relative(api, p).replaceAll("\\", "/")] : [];
  });

describe("tablas de los despachadores", () => {
  it("cada manejador.ts está importado por un despachador", () => {
    const fuentes = [path.join(api, "[...ruta]/route.ts"), path.join(api, "plan/[id]/[...ruta]/route.ts")].map((f) => readFileSync(f, "utf8")).join("\n");
    const importados = [...fuentes.matchAll(/import\("\.\.\/(.+?)"\)/g)].map((m) => m[1]).map((r) => (r.startsWith("..") ? r : r));
    const rel = (m: string) => m.replace(/\/manejador\.ts$/, "/manejador");
    const enDisco = manejadores(api).map(rel);
    // Los del despachador de plan se importan como "../x/manejador" (relativo a plan/[id]); los otros igual relativo a api/.
    const completos = importados.map((i) => i);
    for (const m of enDisco) {
      const corto = m.replace(/^plan\/\[id\]\//, "");
      expect(completos.includes(m) || completos.includes(corto), m).toBe(true);
    }
    expect(completos.length).toBe(enDisco.length);
  });
});
