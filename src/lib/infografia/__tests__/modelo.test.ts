import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calcularPresupuesto } from "@/lib/presupuesto/calcular";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import type { Parada, Plan } from "@/lib/plan/tipos";
import { construirModeloInfografia } from "../modelo";

const parada = (i: number, importe: number, prioridad: number): Parada => ({
  id: `p${i}`, franja_id: "manana", nombre: `Sitio ${i}`, descripcion: "x", duracion_min: 60, prioridad,
  procedencia: { fuente: "propuesto-sin-verificar" }, coste: { importe_eur: importe, por: "persona", procedencia: "estimado", fecha: "2027-06-08" },
});

const etapa = (nombre: string, dia_inicio: number, noche: number) => ({
  ciudad: { estado: "resuelta" as const, nombre, metodo: "destino" as const, caja: { minLat: 38, maxLat: 39, minLon: -10, maxLon: -9 }, intentado_en: "2027-01-01T00:00:00Z" },
  pais: "Portugal", dias: 2, dia_inicio, alojamiento_noche_eur: noche, zona: 0, ajustes: [],
});

function plan(importes: number[], personas: number, multi: boolean): Plan {
  const franjas = franjasComoArray("Portugal");
  const dias = [0, 1, 2, 3].map((d) => ({ fecha: `2027-06-${8 + d}`.replace(/-(\d)$/, "-0$1"), franjas, ...(multi ? { etapa: d < 2 ? 0 : 1 } : {}), paradas: importes.map((im, i) => parada(d * 10 + i, im, 50 + i)) }));
  return {
    id: "x", version: 1, destino: "Portugal", personas, dias,
    ...(multi ? { etapas: [etapa("Lisboa", 0, 90), etapa("Oporto", 2, 80)], traslados: [{ desde: "Lisboa", hasta: "Oporto", modo: "tren" as const, distancia_km: 313, duracion_min: 200, coste_eur: 40, procedencia: "estimado" as const }] } : {}),
  };
}

describe("construirModeloInfografia (inf-ac1, invariante 1)", () => {
  it("los totales coinciden con calcularPresupuesto para cualquier plan", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 200 }), { maxLength: 4 }), fc.integer({ min: 1, max: 8 }), fc.boolean(), fc.option(fc.integer({ min: 100, max: 9000 }), { nil: undefined }), (importes, personas, multi, tuyo) => {
        const p = plan(importes, personas, multi);
        const m = construirModeloInfografia(p, tuyo);
        expect(m.totales.total_eur).toBe(calcularPresupuesto(p).total_eur);
        expect(m.totales.dias).toBe(4);
        expect(m.totales.sitios).toBe(importes.length * 4);
        expect(m.totales.tu_presupuesto_eur).toBe(tuyo);
      }),
    );
  });

  it("multiciudad: una lámina por etapa con 2 paradas de mayor prioridad y km de traslado", () => {
    const m = construirModeloInfografia(plan([10, 10, 10], 2, true), 3000);
    expect(m.bloques.map((b) => b.titulo)).toEqual(["Lisboa", "Oporto"]);
    expect(m.bloques[0].detalle).toBe("2 noches");
    expect(m.bloques[0].paradas).toEqual(["Sitio 2", "Sitio 12"]);
    expect(m.totales.km_traslado).toBe(313);
    expect(m.totales.texto_presupuesto).toMatch(/de 3\.?000 €/);
  });

  it("una ciudad: la misma lámina por días", () => {
    const m = construirModeloInfografia(plan([10, 20], 1, false));
    expect(m.multiciudad).toBe(false);
    expect(m.bloques.map((b) => b.titulo)).toEqual(["Día 1", "Día 2", "Día 3", "Día 4"]);
    expect(m.bloques[0].paradas).toEqual(["Sitio 1", "Sitio 0"]);
  });
});
