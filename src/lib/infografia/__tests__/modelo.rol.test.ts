import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { modeloInfografiaParaRol } from "@/lib/infografia/modelo";
import type { Plan } from "@/lib/plan/tipos";

const FRANJAS = [{ id: "m", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }];

// Importes con cifras que no pueden aparecer por casualidad en el modelo
// (fechas, conteos, kilómetros), para que buscarlos en el JSON sea fiable.
const importe = fc.integer({ min: 70001, max: 79999 });

const planConDinero = fc.record({ noche: importe, traslado: importe, presupuesto: importe, personas: fc.integer({ min: 1, max: 6 }) }).map(({ noche, traslado, presupuesto, personas }) => ({
  noche,
  traslado,
  presupuesto,
  plan: {
    id: "p",
    version: 1,
    destino: "Sevilla",
    personas,
    etapas: [{ ciudad: { estado: "resuelta" as const, nombre: "Sevilla", intentado_en: "2026-10-01T00:00:00Z" }, pais: "ES", dias: 1, dia_inicio: 0, alojamiento_noche_eur: noche, zona: 0, ajustes: [] }],
    traslados: [{ desde: "Madrid", hasta: "Sevilla", modo: "tren" as const, distancia_km: 530, duracion_min: 150, coste_eur: traslado, procedencia: "estimado" as const }],
    dias: [{ fecha: "2027-03-05", etapa: 0, franjas: FRANJAS, paradas: [{ id: "a", franja_id: "m", nombre: "Catedral", descripcion: "", duracion_min: 90, prioridad: 80, procedencia: { fuente: "propuesto-sin-verificar" as const }, coste: { importe_eur: 12, por: "persona" as const, procedencia: "estimado" as const, fecha: "2026-10-01" } }] }],
  } satisfies Plan,
}));

describe("modeloInfografiaParaRol (pin-ac4)", () => {
  it("invariante: el modelo del miembro no tiene totales de dinero ni los importes de alojamiento o traslado", () => {
    fc.assert(
      fc.property(planConDinero, ({ plan, noche, traslado, presupuesto }) => {
        const modelo = modeloInfografiaParaRol(plan, { presupuesto_eur: presupuesto }, "miembro");
        expect(modelo.totales).not.toHaveProperty("total_eur");
        expect(modelo.totales).not.toHaveProperty("tu_presupuesto_eur");
        expect(modelo.totales).not.toHaveProperty("texto_presupuesto");
        const json = JSON.stringify(modelo);
        for (const valor of [noche, traslado, presupuesto]) expect(json).not.toContain(String(valor));
      }),
      { numRuns: 100 },
    );
  });

  it("el dueño sí recibe el texto de presupuesto", () => {
    const { plan } = fc.sample(planConDinero, 1)[0];
    const modelo = modeloInfografiaParaRol(plan, { presupuesto_eur: 4000 }, "duenyo");
    expect(modelo.totales.tu_presupuesto_eur).toBe(4000);
    expect(modelo.totales.texto_presupuesto).toBeDefined();
  });

  it("un plan de una sola ciudad sin etapas tampoco filtra nada al miembro", () => {
    const { plan } = fc.sample(planConDinero, 1)[0];
    const simple: Plan = { ...plan, dias: plan.dias.map((d) => ({ ...d, etapa: undefined })) };
    delete simple.etapas;
    delete simple.traslados;
    const modelo = modeloInfografiaParaRol(simple, { presupuesto_eur: 4321 }, "miembro");
    expect(JSON.stringify(modelo)).not.toMatch(/4321|4\.321/);
    expect(modelo.totales).not.toHaveProperty("total_eur");
  });
});
