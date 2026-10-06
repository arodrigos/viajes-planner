// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelViajes } from "@/app/viajes/PanelViajes";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function viaje(id: string, destino: string, fechaFin: string | null) {
  return { id, destino, fecha: "fechas", fecha_fin: fechaFin, estado: "completado", plan_id: `plan-${id}` };
}

// txt-ac1: el reparto va por el último día del viaje respecto a hoy.
describe("PanelViajes: próximos y pasados (txt-ac1)", () => {
  it("reparte por fecha de fin, deja en «Próximos» el viaje en curso y el que solo tiene época", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 6, 12, 0) });
    const DATOS = {
      correo: "a@ej.com",
      viajes: [
        viaje("1", "Roma", "2026-10-16"),
        viaje("2", "Lisboa", "2026-08-03"),
        viaje("3", "Turín", "2026-10-07"),
        viaje("4", "Oporto", null),
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(DATOS), { status: 200 })));

    render(<PanelViajes />);

    const proximos = await screen.findByRole("region", { name: "Próximos" });
    const pasados = screen.getByRole("region", { name: "Pasados" });
    expect(within(proximos).getByText("Roma")).toBeInTheDocument();
    expect(within(proximos).getByText("Turín")).toBeInTheDocument();
    expect(within(proximos).getByText("Oporto")).toBeInTheDocument();
    expect(within(pasados).getByText("Lisboa")).toBeInTheDocument();
    expect(within(pasados).queryByText("Roma")).not.toBeInTheDocument();
  });

  it("cada grupo vacío explica qué pasa", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ correo: "a@ej.com", viajes: [viaje("1", "Roma", "2999-01-01")] }), { status: 200 })),
    );
    render(<PanelViajes />);
    await waitFor(() => expect(screen.getByText(/aquí aparecerán los viajes que ya hayas hecho/i)).toBeInTheDocument());
  });
});
