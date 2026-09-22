// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VistaPlan } from "@/app/plan/[id]/VistaPlan";

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
        { id: "p1", franja_id: "manana", nombre: "Mercado do Bolhão", descripcion: "Paseo por el mercado." },
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(PLAN_CON_HUECOS), { status: 200 })),
  );
});

describe("VistaPlan con huecos (maq-ac5)", () => {
  it("no pinta la franja 'Comida' del primer día (sin paradas) y explica el segundo día sin paradas", async () => {
    render(<VistaPlan id="plan-huecos" />);

    await waitFor(() => expect(screen.getByText("Mercado do Bolhão")).toBeInTheDocument());

    // (a) la franja del primer día sin paradas ("Comida") no existe en el
    // DOM: hay una sola cabecera "Comida" en todo el documento y es la del
    // segundo día... salvo que el segundo día tampoco tiene comida, así que
    // "Comida" no debe aparecer en absoluto.
    expect(screen.queryByRole("heading", { name: "Comida" })).not.toBeInTheDocument();

    // (b) el segundo día (sin ninguna parada en ninguna franja) muestra el
    // texto explicativo, y ninguna de sus franjas ("Mañana"/"Tarde") pinta
    // una sección.
    expect(screen.getByText(/todavía no hay paradas planificadas/i)).toBeInTheDocument();
    const cabecerasManana = screen.getAllByRole("heading", { name: "Mañana" });
    expect(cabecerasManana).toHaveLength(1); // solo la del primer día, que sí tiene parada.
    expect(screen.queryByRole("heading", { name: "Tarde" })).not.toBeInTheDocument();
  });
});
