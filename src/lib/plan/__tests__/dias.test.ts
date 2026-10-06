import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { diaPorDefecto, formatearFechaChip, formatearFechaDia, hoyEnZona, leerDiaDeUrl } from "../dias";

const fechasArb = fc
  .tuple(fc.integer({ min: 2024, max: 2030 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
  .map(([a, m, d]) => `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);

describe("diaPorDefecto", () => {
  const fechas = ["2027-06-14", "2027-06-15", "2027-06-16", "2027-06-17"];
  it("durante el viaje elige el día de hoy; antes y después, el resumen", () => {
    expect(diaPorDefecto(fechas, "2027-06-16")).toBe(3);
    expect(diaPorDefecto(fechas, "2027-06-10")).toBe("resumen");
    expect(diaPorDefecto(fechas, "2027-06-20")).toBe("resumen");
  });
  it("property: siempre resumen o un día válido, y el día de hoy cuando coincide", () => {
    fc.assert(
      fc.property(fc.array(fechasArb, { minLength: 0, maxLength: 12 }), fechasArb, (fs, hoy) => {
        const r = diaPorDefecto(fs, hoy);
        if (r === "resumen") return !fs.includes(hoy);
        return Number.isInteger(r) && r >= 1 && r <= fs.length && fs[r - 1] === hoy;
      }),
    );
  });
});

describe("leerDiaDeUrl", () => {
  it("acepta resumen y días dentro de rango", () => {
    expect(leerDiaDeUrl("resumen", 4)).toBe("resumen");
    expect(leerDiaDeUrl("2", 4)).toBe(2);
  });
  it("rechaza lo inválido", () => {
    for (const v of ["99", "abc", "", "-1", "1.5", "0", "01", null, undefined, "1e3"]) expect(leerDiaDeUrl(v, 4)).toBeNull();
  });
  it("property: nunca lanza y devuelve null, resumen o un día válido", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.integer().map(String), fc.double().map(String)), fc.integer({ min: 0, max: 30 }), (v, total) => {
        const r = leerDiaDeUrl(v, total);
        return r === null || r === "resumen" || (Number.isInteger(r) && r >= 1 && r <= total);
      }),
    );
  });
});

describe("hoyEnZona", () => {
  it("usa la zona del destino, no la del dispositivo", () => {
    const instante = new Date("2027-06-16T23:30:00Z");
    expect(hoyEnZona("Europe/Lisbon", instante)).toBe("2027-06-17");
    expect(hoyEnZona("America/New_York", instante)).toBe("2027-06-16");
  });
  it("una zona desconocida no lanza", () => {
    expect(hoyEnZona("No/Existe", new Date("2027-06-16T12:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatearFechaDia", () => {
  it("da día de la semana, día y mes", () => {
    expect(formatearFechaDia("2027-06-16")).toBe("mié 16 jun");
    expect(formatearFechaChip("2027-06-14")).toBe("lun 14");
  });
  it("property: nunca devuelve el ISO y siempre lleva el día y una abreviatura de semana", () => {
    fc.assert(
      fc.property(fechasArb, (iso) => {
        const t = formatearFechaDia(iso);
        return t !== iso && !t.includes("-") && /^[a-záéíóú]{2,4} \d{1,2} [a-z]{3,4}$/.test(t);
      }),
    );
  });
});
