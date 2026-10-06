import { describe, expect, it } from "vitest";
import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import { multiciudad } from "../../../../scripts/ejemplos-infografia";

// inf-ac1: cada parada del ejemplo multiciudad está en la ciudad de su etapa.
describe("ejemplo de infografía multiciudad (inf-ac1)", () => {
  it("las paradas de cada etapa caen en su ciudad", () => {
    const etapas = multiciudad.etapas ?? [];
    expect(etapas).toHaveLength(3);
    for (const dia of multiciudad.dias) {
      const { caja, nombre } = etapas[dia.etapa ?? -1].ciudad as unknown as { caja: { minLat: number; maxLat: number; minLon: number; maxLon: number }; nombre: string };
      const centro = { lat: (caja.minLat + caja.maxLat) / 2, lon: (caja.minLon + caja.maxLon) / 2 };
      for (const p of dia.paradas.filter((x) => x.coordenadas)) {
        const dentro = p.coordenadas!.lat >= caja.minLat && p.coordenadas!.lat <= caja.maxLat && p.coordenadas!.lon >= caja.minLon && p.coordenadas!.lon <= caja.maxLon;
        expect(dentro || distanciaMetros(p.coordenadas!, centro) < 15_000, `${p.nombre} fuera de ${nombre}`).toBe(true);
      }
    }
  });

  it("Oporto lleva Ribeira y Coímbra su universidad", () => {
    const nombresDe = (i: number) => multiciudad.dias.filter((d) => d.etapa === i).flatMap((d) => d.paradas.map((p) => p.nombre));
    expect(nombresDe(1)).toContain("Universidad de Coímbra");
    expect(nombresDe(2)).toContain("Ribeira");
    expect(nombresDe(1)).not.toContain("Ribeira");
  });
});
