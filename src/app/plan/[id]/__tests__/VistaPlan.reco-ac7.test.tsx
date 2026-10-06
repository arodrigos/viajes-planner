// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VistaPlan } from "@/app/plan/[id]/VistaPlan";

// reg-ac1: VistaPlan usa useRouter() (regenerar-viaje); este componente no
// vive bajo un App Router real en el test, mismo doble que
// FormularioCriterios.test.tsx.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PLAN_SIN_RECOMENDACIONES = {
  id: "plan-sin-reco",
  version: 1,
  destino: "Oporto",
  personas: 2,
  dias: [],
  avisos: [],
  recomendaciones: [],
};

const PLAN_CON_RECOMENDACIONES = {
  id: "plan-con-reco",
  version: 1,
  destino: "Sevilla",
  personas: 2,
  dias: [],
  avisos: [],
  recomendaciones: [{ tipo: "recinto", nombre: "Real Alcázar", motivo: "Imprescindible, reserva con antelación." }],
};

// reco-ac7(b): recomendaciones: [] no deja la sección muda -explica el
// estado vacío en vez de parecer un error de carga.
describe("VistaPlan sin recomendaciones (reco-ac7(b))", () => {
  it("muestra el estado vacío explicado, sin ningún aviso de búsqueda", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(PLAN_SIN_RECOMENDACIONES), { status: 200 })),
    );

    render(<VistaPlan id="plan-sin-reco" />);

    await waitFor(() => expect(screen.getByText(/no hay recomendaciones de sitios/i)).toBeInTheDocument());
    // ics-ac2 (cambios_tests_justificados): se acota a la sección de
    // recomendaciones -el resto de la página ya tiene el enlace fijo
    // "Añadir al calendario", ajeno al estado vacío que este test comprueba.
    const seccionRecomendaciones = screen.getByRole("region", { name: "Más sitios recomendados" });
    expect(within(seccionRecomendaciones).queryByRole("link")).not.toBeInTheDocument();
  });
});

// reco-ac7(c): el aviso de la sección de recomendaciones es fijo (role
// "note", sin control de cierre en el DOM) y deja claro que el enlace es
// una búsqueda, nunca una ficha verificada ni una reserva.
describe("VistaPlan con recomendaciones (reco-ac7(c))", () => {
  it("muestra un aviso fijo de que el enlace es una búsqueda, no una reserva ni un listado verificado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(PLAN_CON_RECOMENDACIONES), { status: 200 })),
    );

    render(<VistaPlan id="plan-con-reco" />);

    await waitFor(() => expect(screen.getByText("Real Alcázar")).toBeInTheDocument());
    const aviso = screen.getByText(/no una reserva ni un listado verificado/i);
    expect(aviso).toHaveAttribute("role", "note");
    // Sin ningún botón de cerrar cerca del aviso: fijo de verdad, como
    // AVISO_FIJO de arriba.
    expect(aviso.parentElement?.querySelector("button")).toBeNull();
  });
});
