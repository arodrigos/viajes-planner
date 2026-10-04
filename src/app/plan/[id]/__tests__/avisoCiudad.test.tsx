// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvisoCiudad, AVISO_SIN_CIUDAD, MENSAJE_ERROR_GENERICO, MENSAJE_NOMBRE_VACIO } from "@/app/plan/[id]/AvisoCiudad";

afterEach(cleanup);

// man-ac3: los tres mensajes de los caminos que fallan, probados de forma
// aislada del resto de la vista.
describe("AvisoCiudad (man-ac3)", () => {
  it("campo vacío: el botón responde con el mensaje exacto sin llegar a la red", async () => {
    const fetchEspia = vi.spyOn(globalThis, "fetch");
    render(<AvisoCiudad planId="plan-1" ciudad={{ estado: "sin-ciudad-identificable", intentado_en: "2026-01-01T00:00:00Z" }} totalParadas={5} paradasUbicadas={0} />);

    await userEvent.click(screen.getByRole("button", { name: "Guardar ciudad" }));

    expect(screen.getByText(MENSAJE_NOMBRE_VACIO)).toBeInTheDocument();
    expect(fetchEspia).not.toHaveBeenCalled();
    fetchEspia.mockRestore();
  });

  it("ciudad no encontrada (Lisbooa): el motivo exacto del servidor queda visible y el campo sigue disponible", () => {
    render(
      <AvisoCiudad
        planId="plan-1"
        ciudad={{ estado: "sin-ciudad-identificable", motivo: "No hemos encontrado «Lisbooa» en el mapa: comprueba el nombre", intentado_en: "2026-01-01T00:00:00Z" }}
        totalParadas={22}
        paradasUbicadas={0}
      />,
    );

    expect(screen.getByText("No hemos encontrado «Lisbooa» en el mapa: comprueba el nombre")).toBeInTheDocument();
    expect(screen.getByText(AVISO_SIN_CIUDAD)).toBeInTheDocument();
    expect(screen.getByLabelText("¿De qué ciudad es este viaje?")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Guardar ciudad" })).toBeEnabled();
  });

  it("error del servidor: el mensaje explica qué pasó sin un código en crudo", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "fallo interno" }), { status: 500 }));
    render(<AvisoCiudad planId="plan-1" ciudad={{ estado: "sin-ciudad-identificable", intentado_en: "2026-01-01T00:00:00Z" }} totalParadas={5} paradasUbicadas={0} />);

    await userEvent.type(screen.getByLabelText("¿De qué ciudad es este viaje?"), "Valencia");
    await userEvent.click(screen.getByRole("button", { name: "Guardar ciudad" }));

    expect(await screen.findByText(MENSAJE_ERROR_GENERICO)).toBeInTheDocument();
    expect(screen.queryByText("500")).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("el contador respeta 0 <= N <= M y el caso de 0 paradas", () => {
    render(<AvisoCiudad planId="plan-1" totalParadas={0} paradasUbicadas={0} />);
    expect(screen.getByText("Este viaje todavía no tiene sitios")).toBeInTheDocument();
  });

  it("ciudad resuelta: no muestra aviso ni campo, solo el contador", () => {
    render(<AvisoCiudad planId="plan-1" ciudad={{ estado: "resuelta", nombre: "Valencia", metodo: "destino", intentado_en: "2026-01-01T00:00:00Z" }} totalParadas={24} paradasUbicadas={18} />);
    expect(screen.queryByText(AVISO_SIN_CIUDAD)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("¿De qué ciudad es este viaje?")).not.toBeInTheDocument();
    expect(screen.getByText("18 de 24 sitios ubicados")).toBeInTheDocument();
  });
});
