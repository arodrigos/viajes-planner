import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MODOS_TRANSPORTE, type Modo } from "@/lib/criterios/tipos";
import { TOPE_AVION_MIN, TOPE_TIERRA_MIN } from "@/lib/etapas/constantes";
import { estimarTraslado, type Punto } from "@/lib/etapas/traslados";
import type { Dia, EtapaPlan, TrasladoPlan } from "@/lib/plan/tipos";
import { calcularPresupuesto } from "../calcular";

const LISBOA: Punto = { lat: 38.72, lon: -9.14 };
const OPORTO: Punto = { lat: 41.15, lon: -8.61 };
const caja = { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };

function etapaPlan(nombre: string, dias: number, inicio: number, noche: number): EtapaPlan {
  return { ciudad: { estado: "resuelta", nombre, caja } as unknown as EtapaPlan["ciudad"], pais: "Portugal", dias, dia_inicio: inicio, alojamiento_noche_eur: noche, zona: 0, ajustes: [] };
}

const diaConVisita = (importe: number): Dia =>
  ({ fecha: "2026-11-07", franjas: [], paradas: [{ coste: { importe_eur: importe, por: "persona", procedencia: "estimado" } }] }) as unknown as Dia;

function trasladoPlan(modo: Modo, a: Punto, b: Punto, personas: number): TrasladoPlan {
  const t = estimarTraslado(a, b, [modo], personas);
  if (!t) throw new Error("sin traslado");
  return { desde: "A", hasta: "B", ...t };
}

describe("calcularPresupuesto con etapas (eta-ac3 / cp-eta-02)", () => {
  it("Lisboa 4 noches a 90 € + Oporto 3 a 80 €, autobús, 4 personas, visitas 240 €", () => {
    const traslado = trasladoPlan("autobus", LISBOA, OPORTO, 4);
    const dias = [diaConVisita(60), ...Array.from({ length: 7 }, () => ({ fecha: "2026-11-08", franjas: [], paradas: [] }) as Dia)];
    const p = calcularPresupuesto({ personas: 4, dias, etapas: [etapaPlan("Lisboa", 4, 0, 90), etapaPlan("Oporto", 4, 4, 80)], traslados: [traslado] });
    expect(p.alojamiento_eur).toBe(600);
    expect(p.actividades_eur).toBe(240);
    expect(p.traslados_eur).toBeCloseTo(79, 0);
    expect(p.total_eur).toBeCloseTo(p.alojamiento_eur + p.traslados_eur + p.actividades_eur, 2);
  });

  it("sin etapas el resultado es el de siempre: alojamiento y traslados a 0", () => {
    const p = calcularPresupuesto({ personas: 2, dias: [diaConVisita(10)] });
    expect(p.alojamiento_eur).toBe(0);
    expect(p.traslados_eur).toBe(0);
    expect(p.total_eur).toBe(20);
  });
});

describe("invariantes del presupuesto y los traslados (property)", () => {
  const punto = fc.record({ lat: fc.double({ min: 36, max: 42, noNaN: true }), lon: fc.double({ min: -9, max: -6, noNaN: true }) });
  const modos = fc.shuffledSubarray([...MODOS_TRANSPORTE], { minLength: 1 });

  it("3: todo traslado estimado usa un modo permitido, respeta el tope y es «estimado»", () => {
    fc.assert(
      fc.property(punto, punto, modos, fc.integer({ min: 1, max: 8 }), (a, b, ms, personas) => {
        const t = estimarTraslado(a, b, ms, personas);
        if (!t) return;
        expect(ms).toContain(t.modo);
        expect(t.duracion_min).toBeLessThanOrEqual(t.modo === "avion" ? TOPE_AVION_MIN : TOPE_TIERRA_MIN);
        expect(t.procedencia).toBe("estimado");
      }),
      { numRuns: 300 },
    );
  });

  it("4 y 5: traslados = etapas − 1 y total = alojamiento + traslados + actividades", () => {
    const etapasArb = fc.array(fc.record({ dias: fc.integer({ min: 2, max: 5 }), noche: fc.integer({ min: 20, max: 300 }) }), { minLength: 1, maxLength: 6 });
    fc.assert(
      fc.property(etapasArb, fc.integer({ min: 1, max: 6 }), fc.array(fc.integer({ min: 0, max: 200 }), { maxLength: 8 }), (es, personas, visitas) => {
        let inicio = 0;
        const etapas = es.map((e, i) => {
          const x = etapaPlan(`C${i}`, e.dias, inicio, e.noche);
          inicio += e.dias;
          return x;
        });
        const traslados = etapas.slice(1).map(() => trasladoPlan("tren", LISBOA, OPORTO, personas));
        expect(traslados.length).toBe(etapas.length - 1);
        const p = calcularPresupuesto({ personas, dias: visitas.map(diaConVisita), etapas, traslados });
        expect(Math.round(p.total_eur * 100)).toBe(Math.round(p.alojamiento_eur * 100) + Math.round(p.traslados_eur * 100) + Math.round(p.actividades_eur * 100));
        expect(Math.round(p.por_dia.reduce((s, d) => s + d.total_eur * 100, 0))).toBe(Math.round(p.actividades_eur * 100));
      }),
      { numRuns: 200 },
    );
  });
});
