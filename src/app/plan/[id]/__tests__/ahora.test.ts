import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calcularComoLlegar, progresoDelDia, puntosDelDia, siguienteSinVisitar } from "../ahora";
import type { DiaPublico, ParadaPublica } from "../tiposVista";

const FRANJAS = [
  { id: "manana", etiqueta: "Mañana" },
  { id: "comida", etiqueta: "Comida" },
  { id: "tarde", etiqueta: "Tarde" },
];

function parada(i: number, franja: string, ubicada: boolean, visitada: boolean): ParadaPublica {
  return {
    id: `p${i}`,
    franja_id: franja,
    nombre: `Sitio ${i}`,
    descripcion: "d",
    procedencia: { fuente: "osm" },
    coordenadas: ubicada ? { lat: 40 + i / 100, lon: -3 } : undefined,
    visitada: visitada || undefined,
  };
}

const arbitrarioDia = fc
  .array(fc.record({ franja: fc.constantFrom("manana", "comida", "tarde"), ubicada: fc.boolean(), visitada: fc.boolean() }), { maxLength: 12 })
  .map((ps): DiaPublico => ({ fecha: "2027-06-09", franjas: FRANJAS, paradas: ps.map((p, i) => parada(i, p.franja, p.ubicada, p.visitada)) }));

describe("tarjeta Ahora: invariantes (ahora-hoy)", () => {
  it("la siguiente es la primera ubicada sin visitar en el orden de las franjas, o ninguna", () => {
    fc.assert(
      fc.property(arbitrarioDia, (dia) => {
        const puntos = puntosDelDia(dia);
        const visitados = new Set(dia.paradas.filter((p) => p.visitada).map((p) => p.id));
        const siguiente = siguienteSinVisitar(puntos, visitados);
        const esperada = FRANJAS.flatMap((f) => dia.paradas.filter((p) => p.franja_id === f.id)).find((p) => p.coordenadas && !p.visitada);
        expect(siguiente?.id).toBe(esperada?.id);
      }),
    );
  });

  it("el progreso cumple 0 ≤ N ≤ M y M es el número de paradas del día", () => {
    fc.assert(
      fc.property(arbitrarioDia, (dia) => {
        const { visitadas, total } = progresoDelDia(dia);
        expect(visitadas).toBeGreaterThanOrEqual(0);
        expect(visitadas).toBeLessThanOrEqual(total);
        expect(total).toBe(dia.paradas.length);
      }),
    );
  });

  it("«Cómo llegar» solo existe si hay siguiente distinta del origen", () => {
    fc.assert(
      fc.property(arbitrarioDia, (dia) => {
        const puntos = puntosDelDia(dia);
        const visitados = new Set(dia.paradas.filter((p) => p.visitada).map((p) => p.id));
        const siguiente = siguienteSinVisitar(puntos, visitados);
        const href = calcularComoLlegar(puntos, siguiente, visitados);
        if (!siguiente) expect(href).toBeNull();
        if (href) expect(href).toContain("google.com/maps/dir");
      }),
    );
  });
});

describe("tarjeta Ahora: ejemplos (hoy-ac1-a)", () => {
  const dia: DiaPublico = { fecha: "2027-06-09", franjas: FRANJAS, paradas: [parada(1, "manana", true, false), parada(2, "comida", true, false), parada(3, "tarde", true, false)] };

  it("sin visitar: siguiente P1 y sin enlace; con P1 visitada: P2 con enlace de P1 a P2", () => {
    const puntos = puntosDelDia(dia);
    expect(siguienteSinVisitar(puntos, new Set())?.id).toBe("p1");
    expect(calcularComoLlegar(puntos, puntos[0], new Set())).toBeNull();
    const siguiente = siguienteSinVisitar(puntos, new Set(["p1"]));
    expect(siguiente?.id).toBe("p2");
    expect(calcularComoLlegar(puntos, siguiente, new Set(["p1"]))).toContain("origin=40.01,-3&destination=40.02,-3");
  });

  it("con todas visitadas no hay siguiente", () => {
    expect(siguienteSinVisitar(puntosDelDia(dia), new Set(["p1", "p2", "p3"]))).toBeNull();
  });
});
