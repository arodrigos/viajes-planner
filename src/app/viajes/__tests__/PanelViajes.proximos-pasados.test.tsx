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

// mv-ac1/ac4: el viaje en curso con plan listo abre «hoy», va primero y dice qué día es.
describe("PanelViajes: situación y orden (mv-ac1, mv-ac4)", () => {
  it("«Abrir hoy» solo en el viaje en curso, y el orden sigue la fecha de inicio", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 6, 12, 0) });
    const datos = (id: string, destino: string, ini: string, fin: string) => ({
      id,
      destino,
      fecha: `${ini} – ${fin}`,
      fecha_inicio: ini,
      fecha_fin: fin,
      estado: "completado",
      plan_id: `plan-${id}`,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              correo: "a@ej.com",
              viajes: [
                datos("1", "Roma", "2026-11-05", "2026-11-08"),
                datos("2", "Oporto", "2026-10-05", "2026-10-08"),
                datos("3", "Lisboa", "2026-10-07", "2026-10-09"),
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    render(<PanelViajes />);

    const proximos = await screen.findByRole("region", { name: "Próximos" });
    const items = within(proximos).getAllByRole("listitem");
    expect(items.map((i) => within(i).getByRole("strong").textContent)).toEqual(["Oporto", "Lisboa", "Roma"]);
    expect(within(items[0]).getByRole("link", { name: "Abrir hoy" })).toHaveAttribute("href", "/plan/plan-2");
    expect(within(items[0]).getByText("En curso · día 2 de 4")).toBeInTheDocument();
    expect(within(items[1]).getByText("Empieza mañana")).toBeInTheDocument();
    expect(within(items[1]).getByRole("link", { name: "Ver el itinerario" })).toBeInTheDocument();
    expect(within(items[2]).getByText("5–8 nov 2026")).toBeInTheDocument();
    expect(within(items[2]).getByText("Empieza dentro de 30 días")).toBeInTheDocument();
  });
});
