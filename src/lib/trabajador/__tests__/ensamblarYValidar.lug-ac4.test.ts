import { describe, expect, it } from "vitest";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { ensamblarYValidar } from "../procesarTrabajo";

const CRITERIOS: CriteriosViaje = {
  destino_o_tipo: "Sevilla",
  fechas: { modo: "epoca", epoca: "otoño" },
  dias: 5,
  personas: [{ edad: 8 }, { edad: 38 }, { edad: 36 }, { edad: 9 }],
  perfil: "familiar",
  presupuesto_eur: 2000,
};

function respuestaConParada(camposExtra: Record<string, unknown>): string {
  return JSON.stringify({
    dias: [
      {
        fecha: "2026-11-07",
        paradas: [
          {
            franja_id: "manana",
            nombre: "Catedral de Sevilla",
            descripcion: "Visita guiada",
            duracion_min: 90,
            prioridad: 80,
            ...camposExtra,
          },
        ],
      },
    ],
  });
}

// lug-ac4: categoria es lo único nuevo que el modelo aporta; todo lo demás
// (coordenadas, lugar, url) lo rellena resolverPlan, nunca el modelo.
describe("ensamblarYValidar (lug-ac4)", () => {
  it("conserva una categoria válida del enum cerrado", () => {
    const resultado = ensamblarYValidar(CRITERIOS, "plan-lug-ac4a", respuestaConParada({ categoria: "monumento" }));
    expect(resultado.valido).toBe(true);
    if (!resultado.valido) return;
    expect(resultado.plan.dias[0].paradas[0].categoria).toBe("monumento");
  });

  it("descarta una categoria fuera del enum sin invalidar el plan", () => {
    const resultado = ensamblarYValidar(CRITERIOS, "plan-lug-ac4b", respuestaConParada({ categoria: "spa" }));
    expect(resultado.valido).toBe(true);
    if (!resultado.valido) return;
    expect(resultado.plan.dias[0].paradas[0].categoria).toBeUndefined();
  });

  it("descarta coordenadas, lugar y url inventados por el modelo", () => {
    const resultado = ensamblarYValidar(
      CRITERIOS,
      "plan-lug-ac4c",
      respuestaConParada({
        categoria: "monumento",
        coordenadas: { lat: 37.3862, lon: -5.9926 },
        lugar: { fuente: "osm", id: "osm:way/1" },
        url: "https://malicioso.example",
      }),
    );
    expect(resultado.valido).toBe(true);
    if (!resultado.valido) return;
    const parada = resultado.plan.dias[0].paradas[0];
    expect(parada.coordenadas).toBeUndefined();
    expect(parada.lugar).toBeUndefined();
    expect(JSON.stringify(parada)).not.toMatch(/https?:\/\//);
  });

  it("un plan sin categoria sigue validando", () => {
    const resultado = ensamblarYValidar(CRITERIOS, "plan-lug-ac4d", respuestaConParada({}));
    expect(resultado.valido).toBe(true);
    if (!resultado.valido) return;
    expect(resultado.plan.dias[0].paradas[0].categoria).toBeUndefined();
  });
});
