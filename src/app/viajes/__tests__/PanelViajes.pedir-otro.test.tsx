// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelViajes } from "@/app/viajes/PanelViajes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DATOS = {
  correo: "a@ej.com",
  viajes: [
    { id: "1", destino: "Roma", fecha: "fechas", fecha_fin: "2999-01-08", estado: "completado", plan_id: "plan-1" },
    { id: "2", destino: "Oporto", fecha: "fechas", fecha_fin: "2999-02-08", estado: "completado", plan_id: "plan-2" },
  ],
};

// Con varios viajes, el énfasis tiene que estar en la acción de cada
// tarjeta: si «Pedir otro viaje» llevara el mismo estilo marcado, la
// pantalla tendría un control principal más que viajes y ninguno mandaría.
describe("PanelViajes: «Pedir otro viaje» no compite con la acción de cada tarjeta", () => {
  it("el control de cabecera usa el estilo neutro y las tarjetas conservan el principal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(DATOS), { status: 200 })));
    render(<PanelViajes />);

    const control = await screen.findByRole("link", { name: "Pedir otro viaje" });
    expect(control).toHaveClass("boton");
    expect(control).not.toHaveClass("boton-principal");

    const proximos = screen.getByRole("region", { name: "Próximos" });
    for (const item of within(proximos).getAllByRole("listitem")) {
      expect(within(item).getByRole("link", { name: "Ver el itinerario" })).toHaveClass("boton-principal");
    }
  });

  it("va antes que «Cerrar sesión», no pegado debajo de la acción de salir", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(DATOS), { status: 200 })));
    render(<PanelViajes />);

    const control = await screen.findByRole("link", { name: "Pedir otro viaje" });
    const cerrar = screen.getByRole("button", { name: "Cerrar sesión" });
    expect(control.compareDocumentPosition(cerrar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
