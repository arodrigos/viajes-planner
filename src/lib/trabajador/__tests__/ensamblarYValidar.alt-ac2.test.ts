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

function respuestaConParada(alternativas: unknown): string {
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
            categoria: "monumento",
            alternativas,
          },
        ],
      },
    ],
  });
}

// alt-ac2: el ensamblador copia SOLO nombre/descripcion/motivo/duracion_min
// de cada alternativa, descarta las inválidas sin invalidar el plan, y
// recorta a 3 por orden.
describe("ensamblarYValidar (alt-ac2)", () => {
  it("copia una alternativa con nombre, descripcion, motivo y duracion_min, y descarta cualquier campo extra", () => {
    const resultado = ensamblarYValidar(
      CRITERIOS,
      "plan-alt-ac2a",
      respuestaConParada([
        { nombre: "Real Alcázar", descripcion: "Palacio real", motivo: "misma franja, mismo tipo", duracion_min: 100, url: "https://malicioso.example" },
      ]),
    );
    expect(resultado.valido).toBe(true);
    if (!resultado.valido) return;
    const alternativas = resultado.plan.dias[0].paradas[0].alternativas;
    expect(alternativas).toEqual([
      { nombre: "Real Alcázar", descripcion: "Palacio real", motivo: "misma franja, mismo tipo", duracion_min: 100 },
    ]);
  });

  it("descarta una alternativa sin motivo y conserva las demás válidas", () => {
    const resultado = ensamblarYValidar(
      CRITERIOS,
      "plan-alt-ac2b",
      respuestaConParada([
        { nombre: "Sin motivo", descripcion: "x", duracion_min: 50 },
        { nombre: "Plaza de España", descripcion: "Plaza monumental", motivo: "cerca y del mismo tipo", duracion_min: 60 },
      ]),
    );
    expect(resultado.valido).toBe(true);
    if (!resultado.valido) return;
    expect(resultado.plan.dias[0].paradas[0].alternativas).toHaveLength(1);
    expect(resultado.plan.dias[0].paradas[0].alternativas?.[0].nombre).toBe("Plaza de España");
  });

  it("recorta a 3 alternativas aunque el modelo devuelva más", () => {
    const resultado = ensamblarYValidar(
      CRITERIOS,
      "plan-alt-ac2c",
      respuestaConParada(
        Array.from({ length: 5 }, (_, i) => ({
          nombre: `Alternativa ${i}`,
          descripcion: "d",
          motivo: "m",
          duracion_min: 60,
        })),
      ),
    );
    expect(resultado.valido).toBe(true);
    if (!resultado.valido) return;
    expect(resultado.plan.dias[0].paradas[0].alternativas).toHaveLength(3);
  });

  it("un plan sin alternativas sigue validando", () => {
    const resultado = ensamblarYValidar(CRITERIOS, "plan-alt-ac2d", respuestaConParada(undefined));
    expect(resultado.valido).toBe(true);
    if (!resultado.valido) return;
    expect(resultado.plan.dias[0].paradas[0].alternativas).toBeUndefined();
  });
});
