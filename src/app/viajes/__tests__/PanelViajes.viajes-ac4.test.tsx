// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelViajes } from "@/app/viajes/PanelViajes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// viajes-ac4: los tres estados del listado se explican con texto, nunca con
// una pantalla muda -y el vacío nunca es indistinguible del error.
describe("PanelViajes en sus tres estados (viajes-ac4)", () => {
  it("vacío: literal 'Todavía no has pedido ningún viaje' y enlace a /criterios", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ correo: "a@ej.com", viajes: [] }), { status: 200 })),
    );

    render(<PanelViajes />);

    await waitFor(() => expect(screen.getByText(/todavía no has pedido ningún viaje/i)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /cuéntanos tu viaje/i })).toHaveAttribute("href", "/criterios");
  });

  it("error: la consulta fallida se explica, sin dejar una lista en blanco", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "fallo" }), { status: 500 })),
    );

    render(<PanelViajes />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/no se ha podido cargar/i);
    // el mensaje de error no puede confundirse con "no hay viajes": ese
    // literal no aparece en esta rama.
    expect(screen.queryByText(/todavía no has pedido ningún viaje/i)).not.toBeInTheDocument();
  });

  it("con datos: cada viaje muestra destino, fecha y estado, y el texto de ayuda nombra la cuenta", async () => {
    const DATOS = {
      correo: "familia@ej.com",
      viajes: [
        { id: "t1", destino: "Lisboa", fecha: "2026-11-10 – 2026-11-14", estado: "completado", plan_id: "plan-1" },
        { id: "t2", destino: "Roma", fecha: "otoño", estado: "encolado", plan_id: null },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(DATOS), { status: 200 })),
    );

    render(<PanelViajes />);

    await waitFor(() => expect(screen.getByText("Lisboa")).toBeInTheDocument());
    expect(screen.getByText("Roma")).toBeInTheDocument();
    expect(screen.getByText(/cuenta ligada a familia@ej\.com/i)).toBeInTheDocument();

    const enlacePlan = screen.getByRole("link", { name: /ver el itinerario/i });
    expect(enlacePlan).toHaveAttribute("href", "/plan/plan-1");
    const enlaceProgreso = screen.getByRole("link", { name: /ver el progreso/i });
    expect(enlaceProgreso).toHaveAttribute("href", "/trabajos/t2");
  });
});
