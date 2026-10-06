// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VistaPlan } from "@/app/plan/[id]/VistaPlan";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("dia=1"),
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
describe("VistaPlan: panel de alternativas y enlace a la fuente", () => {
  it("sin alternativas no hay panel de alternativas", async () => {
    await pintar(0);
    expect(screen.queryByText(/^Alternativas/)).toBeNull();
  });

  it("con alternativas el panel se llama «Alternativas (N)»", async () => {
    await pintar(2);
    expect(screen.getAllByText("Alternativas (2)")).toHaveLength(1);
  });

  it("el enlace a la fuente se anuncia con su nombre, no como flecha", async () => {
    await pintar(0);
    expect(screen.getByRole("link", { name: "Fuente: OpenStreetMap" })).toBeInTheDocument();
  });

  it("invariante: el panel se renderiza si y solo si hay al menos una alternativa", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 5 }), async (cuantas) => {
        cleanup();
        await pintar(cuantas);
        expect(screen.queryAllByText(/^Alternativas \(/).length).toBe(cuantas >= 1 ? 1 : 0);
      }),
      { numRuns: 12 },
    );
  });
});
