import { describe, expect, it } from "vitest";
import { aPlanPublico } from "@/lib/plan/publico";
import type { Plan } from "@/lib/plan/tipos";

const FRANJA_MANANA = { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" };
const FRANJA_TARDE = { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:30", hora_fin: "19:00" };

function planConAlternativaYVecinos(): Plan {
  return {
    id: "plan-1",
    version: 1,
    destino: "Madrid",
    personas: 2,
    dias: [
      {
        // 2026-10-06 es martes real.
        fecha: "2026-10-06",
        franjas: [FRANJA_MANANA, FRANJA_TARDE],
        paradas: [
          {
            id: "anterior",
            franja_id: "manana",
            nombre: "Puerta del Sol",
            descripcion: "d",
            duracion_min: 30,
            prioridad: 60,
            procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/node/9" },
            coordenadas: { lat: 40.4169, lon: -3.7035 },
          },
          {
            id: "parada-1",
            franja_id: "manana",
            nombre: "Museo del Prado",
            descripcion: "d",
            duracion_min: 90,
            prioridad: 80,
            procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/node/1" },
            categoria: "museo",
            coordenadas: { lat: 40.4138, lon: -3.6921 },
            alternativas: [
              {
                nombre: "Museo Thyssen",
                descripcion: "d",
                motivo: "mismo tipo",
                duracion_min: 90,
                categoria: "museo",
                origen: "modelo",
                coordenadas: { lat: 40.415, lon: -3.694 },
                lugar: {
                  fuente: "osm",
                  id: "osm:node/2",
                  url: "https://www.openstreetmap.org/node/2",
                  nombre_fuente: "Museo Thyssen",
                  etiquetas: { opening_hours: "Mo-Su 10:00-20:00; Tu off" },
                  resuelto_en: "2026-10-04T00:00:00Z",
                },
              },
            ],
          },
          {
            id: "siguiente",
            franja_id: "tarde",
            nombre: "Retiro",
            descripcion: "d",
            duracion_min: 60,
            prioridad: 50,
            procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/node/8" },
            coordenadas: { lat: 40.4153, lon: -3.6844 },
          },
        ],
      },
    ],
  };
}

// enc-ac1: la alternativa pública trae sus etiquetas de encaje ya
// formateadas, calculadas contra los vecinos reales del día.
describe("aPlanPublico expone etiquetasEncaje (enc-ac1)", () => {
  it("incluye distancia a la parada anterior y siguiente, y el estado de apertura real", () => {
    const publico = aPlanPublico(planConAlternativaYVecinos());
    const alternativa = publico.dias[0].paradas[1].alternativas?.[0];
    expect(alternativa).toBeDefined();
    expect(alternativa!.etiquetasEncaje.some((t) => t.includes("parada anterior"))).toBe(true);
    expect(alternativa!.etiquetasEncaje.some((t) => t.includes("siguiente parada"))).toBe(true);
    // martes, "Tu off" -> cerrada.
    expect(alternativa!.etiquetasEncaje).toContain("Cerrado a esa hora");
    expect(alternativa!.etiquetasEncaje).toContain("Misma categoría (museo)");
  });

  it("nunca serializa hora_inicio ni hora_fin, aunque se use para calcular la apertura", () => {
    const publico = aPlanPublico(planConAlternativaYVecinos());
    const json = JSON.stringify(publico);
    expect(json).not.toContain("hora_inicio");
    expect(json).not.toContain("hora_fin");
  });
});

// enc-ac2: cada día trae su paseo estimado, derivado de las paradas
// resueltas del propio plan público -- nunca una llamada a terceros.
describe("aPlanPublico expone paseo por día (enc-ac2)", () => {
  it("un día con >= 2 paradas resueltas trae paseo.km", () => {
    const publico = aPlanPublico(planConAlternativaYVecinos(), "familiar");
    expect(publico.dias[0].paseo?.km).toBeGreaterThan(0);
  });

  it("un día con menos de 2 paradas resueltas no trae paseo", () => {
    const plan = planConAlternativaYVecinos();
    plan.dias[0].paradas = [plan.dias[0].paradas[0]];
    const publico = aPlanPublico(plan, "familiar");
    expect(publico.dias[0].paseo).toBeUndefined();
  });
});
