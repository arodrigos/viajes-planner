import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { heredarAlternativas } from "../sustituir";
import type { Alternativa } from "../tipos";

const alternativa = (nombre: string): Alternativa => ({ id: nombre, nombre, descripcion: "", motivo: "", duracion_min: 60, origen: "modelo" });

// alc-ac1, invariante 3: tras sustituir una parada con k alternativas, la
// parada nueva tiene min(k, 3): las k-1 no elegidas más la sustituida.
describe("heredarAlternativas (alc-ac1)", () => {
  it("con 2 alternativas, la nueva tiene la no elegida y la sustituida", () => {
    const [pilatos, duenas] = [alternativa("Casa de Pilatos"), alternativa("Palacio de las Dueñas")];
    const resultado = heredarAlternativas([pilatos, duenas], pilatos, alternativa("Real Alcázar"));
    expect(resultado.map((a) => a.nombre)).toEqual(["Palacio de las Dueñas", "Real Alcázar"]);
  });

  it("con 3 alternativas, nunca 4: se recorta por orden y la sustituida entra", () => {
    const todas = ["A", "B", "C"].map(alternativa);
    const resultado = heredarAlternativas(todas, todas[0], alternativa("Original"));
    expect(resultado.map((a) => a.nombre)).toEqual(["B", "C", "Original"]);
  });

  it("invariante 3 sobre cualquier k", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), fc.nat(2), (k, indice) => {
        const actuales = Array.from({ length: k }, (_, i) => alternativa(`alt-${i}`));
        const elegida = actuales[indice % k];
        const resultado = heredarAlternativas(actuales, elegida, alternativa("sustituida"));
        expect(resultado).toHaveLength(Math.min(k, 3));
        expect(resultado.map((a) => a.nombre)).not.toContain(elegida.nombre);
        expect(resultado.map((a) => a.nombre)).toContain("sustituida");
      }),
    );
  });
});
