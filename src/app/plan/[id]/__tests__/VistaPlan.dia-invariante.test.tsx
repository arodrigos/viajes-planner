// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VistaPlan } from "@/app/plan/[id]/VistaPlan";

const { busqueda } = vi.hoisted(() => ({ busqueda: { valor: "" } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(busqueda.valor) }));
// maplibre-gl exige WebGL: basta contar cuántos lienzos se montan.
vi.mock("@/app/plan/[id]/MapaDia", () => ({ MapaDia: () => <div data-testid="mapa-falso" /> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function plan(totalDias: number, conParadas: boolean) {
  return {
    id: "p",
    version: 1,
    destino: "Lisboa",
    personas: 2,
    dias: Array.from({ length: totalDias }, (_, i) => ({
      fecha: `2027-06-${String(10 + i).padStart(2, "0")}`,
      franjas: [{ id: "manana", etiqueta: "Mañana" }],
      paradas: conParadas
        ? [{ id: `a${i}`, franja_id: "manana", nombre: `Sitio ${i}`, descripcion: "d", coordenadas: { lat: 38.7, lon: -9.1 }, procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/1" } }]
        : [],
    })),
    avisos: [],
    recomendaciones: [],
    regenerando: false,
    trabajoId: "t",
  };
}

// Invariante de vista-por-dias: para cualquier plan y cualquier ?dia, el DOM
// tiene exactamente un panel (Resumen o un día) y como mucho un mapa.
describe("VistaPlan: un panel visible y como mucho un mapa", () => {
  it("se cumple para cualquier número de días y cualquier valor de ?dia", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 6 }), fc.boolean(), fc.oneof(fc.string(), fc.integer({ min: -3, max: 10 }).map(String), fc.constant("resumen")), async (totalDias, conParadas, valorDia) => {
        busqueda.valor = `dia=${encodeURIComponent(valorDia)}`;
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(plan(totalDias, conParadas)), { status: 200 })));
        const { container, unmount } = render(<VistaPlan id="p" />);
        await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
        expect(container.querySelectorAll("#panel-resumen, section.seccion-dia")).toHaveLength(1);
        expect(screen.queryAllByTestId("mapa-falso").length).toBeLessThanOrEqual(1);
        unmount();
      }),
      { numRuns: 25 },
    );
  });
});
