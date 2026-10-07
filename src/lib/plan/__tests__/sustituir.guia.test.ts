import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { intercambiar } from "../sustituir";
import type { Alternativa, CuriosidadesParada, GuiaParada, Parada } from "../tipos";

const guiaArb: fc.Arbitrary<GuiaParada> = fc.record({
  consejo: fc.string({ minLength: 1, maxLength: 60 }),
  url: fc.constant("https://es.wikivoyage.org/wiki/Londres"),
  licencia: fc.constant("CC BY-SA" as const),
});
const curiosidadesArb: fc.Arbitrary<CuriosidadesParada> = fc.record({
  frases: fc.array(fc.string({ minLength: 1, maxLength: 40 }), { maxLength: 4 }),
  url: fc.constant("https://es.wikipedia.org/wiki/Londres"),
});
const fechaArb = fc.integer({ min: 1_767_225_600_000, max: 1_798_761_600_000 }).map((ms) => new Date(ms).toISOString());

const paradaArb: fc.Arbitrary<Parada> = fc.record(
  {
    id: fc.constant("p1"),
    franja_id: fc.constant("manana"),
    nombre: fc.string({ minLength: 1, maxLength: 20 }),
    descripcion: fc.string({ maxLength: 30 }),
    duracion_min: fc.integer({ min: 15, max: 240 }),
    prioridad: fc.integer({ min: 0, max: 100 }),
    procedencia: fc.constant({ fuente: "propuesto-sin-verificar" as const }),
    motivo: fc.string({ minLength: 1, maxLength: 20 }),
    coste: fc.constant({ importe_eur: 10, por: "persona" as const, procedencia: "wikivoyage" as const, fecha: "2026-10-01" }),
    guia: guiaArb,
    curiosidades: curiosidadesArb,
    guia_intentada_en: fechaArb,
    guia_formato: fc.integer({ min: 1, max: 3 }),
  },
  { requiredKeys: ["id", "franja_id", "nombre", "descripcion", "duracion_min", "prioridad", "procedencia"] },
);

const alternativaArb: fc.Arbitrary<Alternativa> = fc.record(
  {
    id: fc.uuid(),
    nombre: fc.string({ minLength: 1, maxLength: 20 }),
    descripcion: fc.string({ maxLength: 30 }),
    motivo: fc.string({ maxLength: 20 }),
    duracion_min: fc.integer({ min: 15, max: 240 }),
    origen: fc.constant("modelo" as const),
    guia: guiaArb,
    curiosidades: curiosidadesArb,
    guia_intentada_en: fechaArb,
    guia_formato: fc.integer({ min: 1, max: 3 }),
  },
  { requiredKeys: ["id", "nombre", "descripcion", "motivo", "duracion_min", "origen"] },
);

// alg-ac1: invariantes de la herencia para cualquier parada y alternativa.
describe("intercambiar (alg-ac1)", () => {
  it("la parada nueva tiene la guía y las curiosidades de su alternativa, y nunca el motivo ni el coste de la anterior", () => {
    fc.assert(
      fc.property(paradaArb, alternativaArb, (parada, alternativa) => {
        const nueva = intercambiar({ ...parada, alternativas: [alternativa] }, alternativa);
        expect(nueva.guia).toEqual(alternativa.guia);
        expect(nueva.curiosidades).toEqual(alternativa.curiosidades);
        expect(nueva.guia_intentada_en).toEqual(alternativa.guia_intentada_en);
        expect(nueva.guia_formato).toEqual(alternativa.guia_formato);
        expect(nueva.motivo).toBeUndefined();
        expect(nueva.coste).toBeUndefined();
      }),
    );
  });

  it("deshacer no pierde nada: guia, curiosidades y guia_intentada_en vuelven idénticas", () => {
    fc.assert(
      fc.property(paradaArb, alternativaArb, (parada, alternativa) => {
        const nueva = intercambiar({ ...parada, alternativas: [alternativa] }, alternativa);
        const vuelta = nueva.alternativas?.find((a) => a.nombre === parada.nombre);
        expect(vuelta).toBeDefined();
        const original = intercambiar(nueva, vuelta as Alternativa);
        expect(original.guia).toEqual(parada.guia);
        expect(original.curiosidades).toEqual(parada.curiosidades);
        expect(original.guia_intentada_en).toEqual(parada.guia_intentada_en);
        expect(original.guia_formato).toEqual(parada.guia_formato);
        // El motivo y el coste eran del hueco: sobreviven al ir y volver.
        expect(original.motivo).toEqual(parada.motivo);
        expect(original.coste).toEqual(parada.coste);
      }),
    );
  });

  it("límite: una alternativa sin guía deja la parada pendiente (sin guia_intentada_en)", () => {
    const parada: Parada = { id: "p1", franja_id: "manana", nombre: "A", descripcion: "", duracion_min: 60, prioridad: 50, procedencia: { fuente: "propuesto-sin-verificar" }, guia_intentada_en: "2026-10-01T00:00:00Z", guia_formato: 3 };
    const alternativa: Alternativa = { id: "a1", nombre: "B", descripcion: "", motivo: "m", duracion_min: 60, origen: "modelo" };
    const nueva = intercambiar({ ...parada, alternativas: [alternativa] }, alternativa);
    expect(nueva.guia_intentada_en).toBeUndefined();
    expect(nueva.guia).toBeUndefined();
    expect(nueva.guia_formato).toBeUndefined();
  });
});
