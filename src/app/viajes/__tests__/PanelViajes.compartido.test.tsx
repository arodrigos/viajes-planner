// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelViajes } from "@/app/viajes/PanelViajes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const viaje = (id: string, destino: string, compartido: boolean) => ({ id, destino, fecha: "2027-03-05", fecha_inicio: "2027-03-05", fecha_fin: "2027-03-07", estado: "completado", plan_id: `plan-${id}`, compartido });

// cmu-ac2: en Mis viajes, el plan de otra persona lleva su etiqueta y no ofrece borrarlo (el servidor lo rechazaría con 403).
describe("PanelViajes: planes compartidos (cmu-ac2)", () => {
  it("solo la tarjeta compartida lleva «Compartido contigo» y sin «Eliminar»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ correo: "ci@example.com", viajes: [viaje("1", "Sevilla", true), viaje("2", "Lisboa", false)] }), { status: 200 })));
    render(<PanelViajes />);
    await waitFor(() => expect(screen.getByText("Sevilla")).toBeInTheDocument());

    const sevilla = screen.getByText("Sevilla").closest("li")!;
    const lisboa = screen.getByText("Lisboa").closest("li")!;
    expect(within(sevilla).getByTestId("etiqueta-compartido")).toHaveTextContent("Compartido contigo");
    expect(within(sevilla).queryByRole("button", { name: "Eliminar" })).toBeNull();
    expect(within(sevilla).getByRole("link", { name: /itinerario/ })).toHaveAttribute("href", "/plan/plan-1");
    expect(within(lisboa).queryByTestId("etiqueta-compartido")).toBeNull();
    expect(within(lisboa).getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
  });
});
