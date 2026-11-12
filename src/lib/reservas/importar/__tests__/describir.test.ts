import { describe, expect, it } from "vitest";
import { ciudadDeZona, etiquetaMomento } from "../describir";
import type { Momento } from "../tipos";

const m = (p: Partial<Momento>): Momento => ({ fecha: "2027-07-03", hora: "07:35", zona: "Europe/Madrid", forma: "tzid", zonaDeducida: false, ...p });

describe("describir un momento del .ics para una persona (imp-ac2)", () => {
  it("hora, día y zona en palabras", () => {
    expect(etiquetaMomento(m({}))).toBe("07:35 · sáb 3 jul 2027 · hora de Madrid");
    expect(etiquetaMomento(m({ fecha: "2027-07-09", hora: "19:20", zona: "Europe/Rome" }))).toBe("19:20 · vie 9 jul 2027 · hora de Roma");
  });
  it("sin hora ni zona solo dice el día", () => {
    expect(etiquetaMomento(m({ hora: null, zona: null, forma: "fecha" }))).toBe("sáb 3 jul 2027");
  });
  it("la ciudad sale del último tramo de la zona IANA", () => {
    expect(ciudadDeZona("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(ciudadDeZona("UTC")).toBe("UTC");
  });
});
