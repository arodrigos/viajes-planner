import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calcularPaseoDia } from "../paseo";
import { formatearMinutos } from "@/lib/formato/numeros";
import { calcularTramosDia, umbralAPieKm, type PuntoTramo } from "../tramos";
import { urlRecorridoDia } from "../urlRecorridoDia";

// tra-ac1 / cp-tra-01: coordenadas reales de Londres.
const LONDRES: PuntoTramo[] = [
  { id: "bm", lat: 51.5194, lon: -0.127 },
  { id: "cg", lat: 51.5117, lon: -0.124 },
  { id: "wb", lat: 51.6906, lon: -0.4181 },
];

// 1 grado de latitud son ~111,32 km: dos puntos separados `kmCalle` km de
// calle (línea recta × 1,3) moviendo solo la latitud.
function parConKm(kmCalle: number): PuntoTramo[] {
  return [
    { id: "a", lat: 40, lon: -3 },
    { id: "b", lat: 40 + kmCalle / 1.3 / 111.32, lon: -3 },
  ];
}

describe("calcularTramosDia (tra-ac1, cp-tra-01)", () => {
  it("Londres en familia: andando el corto, transporte público el largo", () => {
    const [corto, largo] = calcularTramosDia(LONDRES, { perfil: "familiar" });
    expect(corto.km).toBeCloseTo(1.1, 1);
    expect(corto.modo).toBe("a-pie");
    expect(corto.minutos).toBe(20);
    expect(corto.href).toContain("travelmode=walking");
    // Covent Garden → Warner Bros. son 28,4 km en línea recta (haversine) × 1,3.
    expect(largo.km).toBeGreaterThanOrEqual(36.7);
    expect(largo.km).toBeLessThanOrEqual(37.3);
    expect(largo.modo).toBe("transporte-publico");
    expect(Math.abs(largo.minutos - 130)).toBeLessThanOrEqual(5);
    expect(largo.href.startsWith("https://www.google.com/maps/dir/?api=1&origin=51.5117,-0.124")).toBe(true);
    expect(largo.href).toContain("travelmode=transit");
  });

  it("límite familiar: 1,5 km a pie, 1,6 km transporte público", () => {
    expect(calcularTramosDia(parConKm(1.5), { perfil: "familiar" })[0].modo).toBe("a-pie");
    expect(calcularTramosDia(parConKm(1.6), { perfil: "familiar" })[0].modo).toBe("transporte-publico");
  });

  it("límite pareja: 2,0 km a pie, 2,1 km transporte público", () => {
    expect(calcularTramosDia(parConKm(2.0), { perfil: "pareja" })[0].modo).toBe("a-pie");
    expect(calcularTramosDia(parConKm(2.1), { perfil: "pareja" })[0].modo).toBe("transporte-publico");
  });

  it("pareja: el tramo largo de Londres sigue siendo transporte público", () => {
    expect(calcularTramosDia(LONDRES, { perfil: "pareja" })[1].modo).toBe("transporte-publico");
  });

  it("solo coche: tramo largo en coche, 95 min y driving", () => {
    const largo = calcularTramosDia(LONDRES, { perfil: "familiar", transporte: ["coche"] })[1];
    expect(largo.modo).toBe("coche");
    expect(largo.minutos).toBe(95);
    expect(largo.href).toContain("travelmode=driving");
  });

  it("coche y tren: sigue siendo transporte público", () => {
    expect(calcularTramosDia(LONDRES, { perfil: "familiar", transporte: ["coche", "tren"] })[1].modo).toBe("transporte-publico");
  });

  it("formatea minutos como horas y minutos", () => {
    expect(formatearMinutos(20)).toBe("20 min");
    expect(formatearMinutos(130)).toBe("2 h 10 min");
    expect(formatearMinutos(120)).toBe("2 h");
  });
});

const punto = fc.record({ lat: fc.double({ min: 35, max: 60, noNaN: true }), lon: fc.double({ min: -10, max: 30, noNaN: true }) });
const puntos = fc.array(punto, { maxLength: 8 }).map((ps): PuntoTramo[] => ps.map((p, i) => ({ id: `p${i}`, ...p })));
const perfil = fc.constantFrom("familiar", "pareja", "amigos", "solo", null);
const transporte = fc.constantFrom(null, ["coche"], ["coche", "tren"], ["tren"], ["avion"]);
const TRAVELMODE = { "a-pie": "walking", "transporte-publico": "transit", coche: "driving" } as const;

describe("invariantes de calcularTramosDia (property tests, tra-ac1)", () => {
  it("n paradas dan n − 1 tramos (0 si n < 2), en orden", () => {
    fc.assert(
      fc.property(puntos, perfil, transporte, (ps, pf, tr) => {
        const tramos = calcularTramosDia(ps, { perfil: pf, transporte: tr });
        expect(tramos).toHaveLength(Math.max(0, ps.length - 1));
        tramos.forEach((t, i) => {
          expect(t.desdeId).toBe(ps[i].id);
          expect(t.hastaId).toBe(ps[i + 1].id);
        });
      }),
    );
  });

  it("a-pie si y solo si km ≤ umbral del perfil", () => {
    fc.assert(
      fc.property(puntos, perfil, transporte, (ps, pf, tr) => {
        for (const t of calcularTramosDia(ps, { perfil: pf, transporte: tr })) {
          expect(t.modo === "a-pie").toBe(t.km <= (pf === "familiar" ? 1.5 : 2.0));
          expect(umbralAPieKm(pf)).toBe(pf === "familiar" ? 1.5 : 2.0);
        }
      }),
    );
  });

  it("minutos múltiplo de 5, positivo y no decreciente con km a igual modo", () => {
    fc.assert(
      fc.property(puntos, perfil, transporte, (ps, pf, tr) => {
        const tramos = calcularTramosDia(ps, { perfil: pf, transporte: tr });
        for (const t of tramos) {
          expect(t.minutos % 5).toBe(0);
          expect(t.minutos).toBeGreaterThan(0);
        }
        for (const a of tramos) for (const b of tramos) if (a.modo === b.modo && a.km <= b.km) expect(a.minutos).toBeLessThanOrEqual(b.minutos);
      }),
    );
  });

  it("el travelmode del href coincide con el modo", () => {
    fc.assert(
      fc.property(puntos, perfil, transporte, (ps, pf, tr) => {
        for (const t of calcularTramosDia(ps, { perfil: pf, transporte: tr })) expect(t.href).toContain(`travelmode=${TRAVELMODE[t.modo]}`);
      }),
    );
  });

  it("km a pie + km en transporte = suma de los tramos", () => {
    fc.assert(
      fc.property(puntos, perfil, transporte, (ps, pf, tr) => {
        const paseo = calcularPaseoDia(ps.map((p) => ({ ...p, nombre: p.id })), pf, tr);
        const total = calcularTramosDia(ps, { perfil: pf, transporte: tr }).reduce((s, t) => s + t.km, 0);
        if (!paseo) {
          expect(ps.length).toBeLessThan(2);
          return;
        }
        expect(Math.abs(paseo.km + (paseo.kmTransporte ?? 0) - total)).toBeLessThanOrEqual(0.1 * ps.length);
      }),
    );
  });

  it("urlRecorridoDia incluye travelmode=walking solo si todos los tramos son a pie", () => {
    fc.assert(
      fc.property(puntos, perfil, transporte, (ps, pf, tr) => {
        const todoAPie = calcularTramosDia(ps, { perfil: pf, transporte: tr }).every((t) => t.modo === "a-pie");
        for (const e of urlRecorridoDia(ps, todoAPie)) expect(e.href.includes("travelmode=walking")).toBe(todoAPie);
      }),
    );
  });
});
