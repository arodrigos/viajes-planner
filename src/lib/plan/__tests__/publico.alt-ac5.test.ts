import { describe, expect, it } from "vitest";
import { aPlanPublico } from "@/lib/plan/publico";
import type { Plan } from "@/lib/plan/tipos";

function planConAlternativa(): Plan {
  return {
    id: "plan-1",
    version: 1,
    destino: "Madrid",
    personas: 2,
    dias: [
      {
        fecha: "2026-11-07",
        franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
        paradas: [
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
                lugar: { fuente: "osm", id: "osm:node/2", url: "https://www.openstreetmap.org/node/2", nombre_fuente: "Museo Thyssen", etiquetas: {}, resuelto_en: "2026-10-04T00:00:00Z" },
              },
              { nombre: "Sin resolver", descripcion: "d", motivo: "m", duracion_min: 60, categoria: "museo", origen: "cercano" },
            ],
          },
        ],
      },
    ],
  };
}

// alt-ac5: la alternativa pública trae procedencia derivada de `lugar`
// (nunca 'propuesto-sin-verificar' si resolvió) y distancia_m calculada
// contra las coordenadas de la parada.
describe("aPlanPublico (alt-ac5)", () => {
  it("deriva procedencia y distancia_m de cada alternativa resuelta", () => {
    const publico = aPlanPublico(planConAlternativa());
    const alternativas = publico.dias[0].paradas[0].alternativas;
    expect(alternativas).toHaveLength(2);
    expect(alternativas?.[0].procedencia).toEqual({ fuente: "osm", url: "https://www.openstreetmap.org/node/2" });
    expect(alternativas?.[0].distancia_m).toBeGreaterThan(0);
  });

  it("una alternativa sin coordenadas propias tiene procedencia 'propuesto-sin-verificar' y sin distancia_m", () => {
    const publico = aPlanPublico(planConAlternativa());
    const sinResolver = publico.dias[0].paradas[0].alternativas?.[1];
    expect(sinResolver?.procedencia).toEqual({ fuente: "propuesto-sin-verificar" });
    expect(sinResolver?.distancia_m).toBeUndefined();
  });
});
