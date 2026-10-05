import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Plan } from "@/lib/plan/tipos";
import type { CajaDelimitadora } from "@/lib/lugares/tipos";
import { fuenteZonasGrabada } from "@/lib/testing/nominatimGrabado";
import { clasificarDestino, type Zona } from "../clasificar";
import { cerrarEtapas, extraerEtapasPropuestas, type EtapaSituada } from "../multiciudad";
import { porEtapas } from "../porEtapa";

async function zonasDe(destino: string): Promise<Zona[]> {
  const c = await clasificarDestino(fuenteZonasGrabada().fuente, destino);
  if (c.modo !== "multiciudad") throw new Error("no es multiciudad");
  return c.zonas;
}

const cajaDe = (lat: number, lon: number): CajaDelimitadora => ({ minLat: lat - 0.1, maxLat: lat + 0.1, minLon: lon - 0.1, maxLon: lon + 0.1 });
const CIUDADES: Record<string, [number, number]> = { Lisboa: [38.72, -9.14], Oporto: [41.15, -8.61], Sevilla: [37.39, -5.99] };

function situada(ciudad: string, dias: number, zonas: readonly Zona[], noche = 90): EtapaSituada {
  const [lat, lon] = CIUDADES[ciudad];
  const z = zonas.findIndex((x) => lat >= x.caja.minLat && lat <= x.caja.maxLat && lon >= x.caja.minLon && lon <= x.caja.maxLon);
  return { ciudad, pais: "Portugal", dias, alojamiento_noche_eur: noche, punto: { lat, lon }, zona: z === -1 ? null : z, ajustes: [], caja: cajaDe(lat, lon) };
}

// Plan de 8 días con una visita en cada franja de la mañana.
function plan(dias = 8): Plan {
  return {
    personas: 4,
    dias: Array.from({ length: dias }, (_, i) => ({
      fecha: `2026-11-${String(7 + i).padStart(2, "0")}`,
      franjas: [{ id: "manana", etiqueta: "Mañana" }, { id: "tarde", etiqueta: "Tarde" }],
      paradas: [{ nombre: `Parada ${i}`, franja_id: "manana", coste: { importe_eur: 10, por: "persona", procedencia: "estimado" } }],
    })),
  } as unknown as Plan;
}

const modos = ["tren", "autobus"] as const;

describe("cerrarEtapas (eta-ac1/eta-ac2)", () => {
  it("cierra Lisboa+Oporto: ciudad multiciudad, dia.etapa, 1 traslado y franja de llegada vacía con ajuste", async () => {
    const zonas = await zonasDe("Portugal");
    const r = cerrarEtapas(plan(), [situada("Lisboa", 4, zonas), situada("Oporto", 4, zonas)], { zonas, modos: [...modos], personas: 4, presupuestoEur: 3000 });
    expect(r.inviable).toBe(false);
    if (r.inviable) return;
    expect(r.plan.ciudad?.estado).toBe("multiciudad");
    expect(r.plan.dias.map((d) => d.etapa)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(r.plan.traslados).toHaveLength(1);
    expect(r.plan.traslados?.[0].procedencia).toBe("estimado");
    expect(r.plan.dias[4].paradas).toHaveLength(0);
    expect(r.plan.etapas?.[1].ajustes.join(" ")).toMatch(/Oporto/);
    expect(r.plan.etapas?.[1].dia_inicio).toBe(4);
  });

  it("zona sin etapa → inviable, sin plan", async () => {
    const zonas = await zonasDe("Portugal y España");
    const r = cerrarEtapas(plan(), [situada("Lisboa", 4, zonas), situada("Oporto", 4, zonas)], { zonas, modos: [...modos], personas: 4, presupuestoEur: 3000 });
    expect(r.inviable).toBe(true);
    if (!r.inviable) return;
    expect(r.descarte.razones[0].codigo).toBe("zona-sin-etapa");
  });

  it("presupuesto superado → inviable con código presupuesto", async () => {
    const zonas = await zonasDe("Portugal");
    const r = cerrarEtapas(plan(), [situada("Lisboa", 4, zonas), situada("Oporto", 4, zonas)], { zonas, modos: [...modos], personas: 4, presupuestoEur: 300 });
    expect(r.inviable).toBe(true);
    if (!r.inviable) return;
    expect(r.descarte.razones.some((x) => x.codigo === "presupuesto")).toBe(true);
  });

  it("8: cada parada se resuelve contra la caja de SU etapa", async () => {
    const zonas = await zonasDe("Portugal");
    const r = cerrarEtapas(plan(), [situada("Lisboa", 4, zonas), situada("Oporto", 4, zonas)], { zonas, modos: [...modos], personas: 4, presupuestoEur: 3000 });
    if (r.inviable) throw new Error("inesperado");
    const vistas: { dias: number; centro: number }[] = [];
    await porEtapas(r.plan, async (sub, cual) => {
      vistas.push({ dias: sub.dias.length, centro: (cual.caja.minLat + cual.caja.maxLat) / 2 });
      return sub;
    });
    expect(vistas.map((v) => v.dias)).toEqual([4, 4]);
    expect(vistas[0].centro).toBeCloseTo(38.72, 1);
    expect(vistas[1].centro).toBeCloseTo(41.15, 1);
  });

  it("6: para cualquier reparto válido, la primera franja de cada día de llegada queda libre", async () => {
    const zonas = await zonasDe("Portugal");
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), (primera) => {
        const r = cerrarEtapas(plan(8), [situada("Lisboa", primera, zonas), situada("Oporto", 8 - primera, zonas)], { zonas, modos: [...modos], personas: 4, presupuestoEur: 5000 });
        if (r.inviable) return;
        expect(r.plan.dias[primera].paradas.some((p) => p.franja_id === "manana")).toBe(false);
      }),
    );
  });
});

describe("extraerEtapasPropuestas", () => {
  it("copia solo campos válidos y sustituye un alojamiento absurdo por el piso con ajuste", () => {
    const e = extraerEtapasPropuestas({ etapas: [{ ciudad: "Lisboa", pais: "Portugal", dias: 4, alojamiento_noche_eur: -5, motivo: "x", extra: 1 }, { ciudad: "<b>", dias: 2 }, { ciudad: "Oporto", dias: 1.5 }] }, 4);
    expect(e).toHaveLength(1);
    expect(e[0].alojamiento_noche_eur).toBe(80);
    expect(e[0].ajustes[0]).toMatch(/Lisboa/);
  });

  it("sin etapas o forma inesperada devuelve []", () => {
    expect(extraerEtapasPropuestas(null, 2)).toEqual([]);
    expect(extraerEtapasPropuestas({ etapas: "x" }, 2)).toEqual([]);
  });
});
