// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VistaPlan } from "@/app/plan/[id]/VistaPlan";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function planConAlternativas(cuantas: number) {
  return {
    id: "plan-cam",
    version: 1,
    destino: "Sevilla",
    personas: 2,
    dias: [
      {
        fecha: "2026-11-01",
        franjas: [{ id: "manana", etiqueta: "Mañana" }],
        paradas: [
          {
            id: "p1",
            franja_id: "manana",
            nombre: "Real Alcázar",
            descripcion: "Palacio.",
            procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/1" },
            alternativas: Array.from({ length: cuantas }, (_, i) => ({
              id: `a${i}`,
              nombre: `Alternativa ${i}`,
              motivo: "mismo tipo",
              origen: "modelo",
              etiquetasEncaje: [],
            })),
          },
        ],
      },
    ],
    avisos: [],
  };
}

async function pintar(cuantas: number) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(planConAlternativas(cuantas)), { status: 200 })));
  render(<VistaPlan id="plan-cam" />);
  await waitFor(() => expect(screen.getByText("Real Alcázar")).toBeInTheDocument());
}

// cam-ac1 / cam-ac3
describe("VistaPlan: botón de cambio y enlace a la fuente", () => {
  it("sin alternativas no hay ningún botón de cambio", async () => {
    await pintar(0);
    expect(screen.queryByRole("button", { name: /Cambiar/ })).toBeNull();
  });

  it("con alternativas el botón se llama «Cambiar por una alternativa»", async () => {
    await pintar(2);
    expect(screen.getAllByRole("button", { name: "Cambiar por una alternativa" })).toHaveLength(1);
  });

  it("el enlace a la fuente se anuncia con fuente y sitio, no como flecha", async () => {
    await pintar(0);
    expect(screen.getByRole("link", { name: "Ver en OpenStreetMap: Real Alcázar" })).toBeInTheDocument();
  });

  it("invariante: el botón se renderiza si y solo si hay al menos una alternativa", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 5 }), async (cuantas) => {
        cleanup();
        await pintar(cuantas);
        expect(screen.queryAllByRole("button", { name: /Cambiar/ }).length).toBe(cuantas >= 1 ? 1 : 0);
      }),
      { numRuns: 12 },
    );
  });
});
