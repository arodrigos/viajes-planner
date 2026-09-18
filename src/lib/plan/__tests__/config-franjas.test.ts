import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { franjasParaDestino } from "@/lib/plan/config-franjas";

describe("franjasParaDestino", () => {
  it("produce horas de comida distintas para destinos distintos", () => {
    const estocolmo = franjasParaDestino("Estocolmo");
    const sevilla = franjasParaDestino("Sevilla");
    expect(estocolmo.comida.hora_inicio).not.toBe(sevilla.comida.hora_inicio);
    expect(estocolmo.comida.etiqueta).toBe(sevilla.comida.etiqueta);
  });

  it("cae al valor por defecto para un destino sin solape declarado", () => {
    const generico = franjasParaDestino("Un lugar cualquiera");
    expect(generico.comida.hora_inicio).toBe("13:00");
  });
});

describe("los límites horarios solo viven en config-franjas.ts", () => {
  const RAIZ_SRC = join(import.meta.dirname, "..", "..", "..");
  const PATRON_HORA = /\b([01]\d|2[0-3]):[0-5]\d\b/;

  function ficherosTs(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) return ficherosTs(ruta);
      return entrada.name.endsWith(".ts") || entrada.name.endsWith(".tsx") ? [ruta] : [];
    });
  }

  it("no hay literales horarios fuera de config-franjas.ts, tests y fixtures", () => {
    const infractores = ficherosTs(RAIZ_SRC)
      .filter((ruta) => {
        const rel = relative(RAIZ_SRC, ruta);
        return (
          !rel.endsWith("plan/config-franjas.ts") &&
          !rel.includes("__tests__") &&
          !rel.includes("__fixtures__")
        );
      })
      .filter((ruta) => PATRON_HORA.test(readFileSync(ruta, "utf8")));

    expect(infractores).toEqual([]);
  });
});
