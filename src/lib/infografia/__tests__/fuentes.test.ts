import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALTO_LAMINA, ANCHO_LAMINA } from "../Lamina";
import { opcionesLamina } from "../opciones";

const raiz = join(import.meta.dirname, "..", "..", "..", "..");
const fuente = (ruta: string) => readFileSync(join(raiz, ruta), "utf8");

describe("opcionesLamina (lam-ac4, invariante 6)", () => {
  it("lleva Inter 400 y 700 con datos no vacíos y el tamaño de la lámina", () => {
    const o = opcionesLamina();
    expect([o.width, o.height]).toEqual([ANCHO_LAMINA, ALTO_LAMINA]);
    for (const peso of [400, 700]) {
      const f = o.fonts.filter((x) => x.name === "Inter" && x.weight === peso);
      expect(f.length).toBeGreaterThanOrEqual(2);
      for (const x of f) expect(x.data.byteLength).toBeGreaterThan(1000);
    }
  });

  it("la ruta, el generador y el medidor importan opcionesLamina", () => {
    for (const ruta of ["src/app/api/plan/[id]/infografia.png/route.tsx", "scripts/generar-infografia-ejemplo.ts", "scripts/medir-lamina.ts"]) {
      expect(fuente(ruta)).toMatch(/import \{ opcionesLamina \} from ".*infografia\/opciones"/);
      expect(fuente(ruta)).toContain("opcionesLamina()");
    }
  });

  it("las fuentes viajan con el despliegue: outputFileTracingIncludes cubre la ruta", () => {
    expect(fuente("next.config.ts")).toMatch(/outputFileTracingIncludes[\s\S]*infografia\.png[\s\S]*assets\/fuentes/);
  });
});
