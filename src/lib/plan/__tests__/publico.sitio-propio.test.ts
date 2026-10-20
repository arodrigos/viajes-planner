import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { aPlanPublico, motivoDeSitio } from "@/lib/plan/publico";
import type { InfoResolucion, Parada, Plan } from "@/lib/plan/tipos";

const FRANJAS = [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }];

function parada(extra: Partial<Parada>): Parada {
  return {
    id: "propia-1",
    franja_id: "manana",
    nombre: "Casa Fassi",
    descripcion: "",
    duracion_min: 60,
    prioridad: 50,
    procedencia: { fuente: "propuesto-sin-verificar" },
    ...extra,
  };
}

function plan(paradas: Parada[]): Plan {
  return { id: "p", version: 1, destino: "Fez", personas: 2, dias: [{ fecha: "2026-11-07", franjas: FRANJAS, paradas }] };
}

const res = (estado: InfoResolucion["estado"], categoria_motivo?: InfoResolucion["categoria_motivo"]): InfoResolucion => ({
  estado,
  intentado_en: "2026-10-20T00:00:00Z",
  ...(categoria_motivo ? { categoria_motivo } : {}),
});

describe("estadoSitio y motivoSitio (spd-ac2)", () => {
  it("una parada propia sin resolución está buscando", () => {
    const [p] = aPlanPublico(plan([parada({ propia: true })])).dias[0].paradas;
    expect(p.estadoSitio).toBe("buscando");
    expect(p.motivoSitio).toBeUndefined();
  });

  it("resuelta, no resuelta y error se distinguen", () => {
    const estados = (r: InfoResolucion) => aPlanPublico(plan([parada({ propia: true, resolucion: r })])).dias[0].paradas[0];
    expect(estados(res("resuelta")).estadoSitio).toBe("resuelto");
    expect(estados(res("no-resuelta", "sin-candidatos")).estadoSitio).toBe("no-encontrado");
    expect(estados(res("error")).estadoSitio).toBe("error");
  });

  it("textos exactos según el motivo, con la ciudad", () => {
    const nombre = "Zzqx";
    expect(motivoDeSitio({ nombre, resolucion: res("no-resuelta", "sin-candidatos") }, "Fez")).toBe("No hemos encontrado «Zzqx» en el mapa de Fez. Revisa cómo se escribe.");
    expect(motivoDeSitio({ nombre, resolucion: res("no-resuelta", "nombre-distinto") }, "Fez")).toBe("No hemos encontrado «Zzqx» con ese nombre exacto en Fez. Revisa cómo se escribe.");
    expect(motivoDeSitio({ nombre, resolucion: res("no-resuelta", "fuera-de-caja") }, "Fez")).toBe("Hay un sitio con ese nombre, pero fuera de Fez.");
    expect(motivoDeSitio({ nombre, resolucion: res("error") }, "Fez")).toBe("No hemos podido buscarlo ahora; lo intentaremos en unos minutos.");
    expect(motivoDeSitio({ nombre, resolucion: res("resuelta") }, "Fez")).toBeUndefined();
  });

  it("las paradas del modelo no llevan estadoSitio", () => {
    const [p] = aPlanPublico(plan([parada({ resolucion: res("no-resuelta") })])).dias[0].paradas;
    expect(p.estadoSitio).toBeUndefined();
    expect(p.motivoSitio).toBeUndefined();
  });

  it("usa la ciudad del plan en el motivo", () => {
    const [p] = aPlanPublico(plan([parada({ propia: true, resolucion: res("no-resuelta") })])).dias[0].paradas;
    expect(p.motivoSitio).toContain("Fez");
  });

  it("la nota viaja tal cual, sin interpretar como marcado (propiedad)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (nota) => {
        const [p] = aPlanPublico(plan([parada({ propia: true, nota })])).dias[0].paradas;
        return p.nota === nota;
      }),
      { numRuns: 100 },
    );
  });
});
