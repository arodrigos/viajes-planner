// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VistaPlan } from "@/app/plan/[id]/VistaPlan";

// reg-ac1: VistaPlan usa useRouter() (regenerar-viaje); este componente no
// vive bajo un App Router real en el test, mismo doble que
// FormularioCriterios.test.tsx.
const { busqueda } = vi.hoisted(() => ({ busqueda: { valor: "dia=1" } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(busqueda.valor),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// maq-ac5: una franja sin paradas no pinta un tramo vacío, y un día entero
// sin paradas explica el hueco en vez de quedarse mudo.
const PLAN_CON_HUECOS = {
  id: "plan-huecos",
  version: 1,
  destino: "Oporto",
  personas: 2,
  dias: [
    {
      fecha: "2026-11-01",
      franjas: [
        { id: "manana", etiqueta: "Mañana" },
        { id: "comida", etiqueta: "Comida" },
      ],
      paradas: [
        {
          id: "p1",
          franja_id: "manana",
          nombre: "Mercado do Bolhão",
          descripcion: "Paseo por el mercado.",
          procedencia: { fuente: "propuesto-sin-verificar" },
        },
      ],
    },
    {
      fecha: "2026-11-02",
      franjas: [
        { id: "manana", etiqueta: "Mañana" },
        { id: "tarde", etiqueta: "Tarde" },
      ],
      paradas: [],
    },
  ],
  avisos: [],
};

beforeEach(() => {
  busqueda.valor = "dia=1";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(PLAN_CON_HUECOS), { status: 200 })),
  );
});

describe("VistaPlan con huecos (maq-ac5)", () => {
  it("no pinta la franja 'Comida' del primer día (sin paradas) y explica el segundo día sin paradas", async () => {
    render(<VistaPlan id="plan-huecos" />);

    await waitFor(() => expect(screen.getByText("Mercado do Bolhão")).toBeInTheDocument());

    // (a) la franja del primer día sin paradas ("Comida") no existe en el DOM.
    expect(screen.queryByRole("heading", { name: "Comida" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Mañana" })).toHaveLength(1);
  });

  it("el segundo día, sin ninguna parada, explica el hueco y no pinta ninguna franja", async () => {
    busqueda.valor = "dia=2";
    render(<VistaPlan id="plan-huecos" />);
    await waitFor(() => expect(screen.getByText(/todavía no hay paradas planificadas/i)).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Mañana" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Tarde" })).not.toBeInTheDocument();
  });
});
