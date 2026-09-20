// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormularioCriterios } from "@/app/criterios/FormularioCriterios";
import { leerBorrador } from "@/lib/criterios/borrador";
import { validarCriterios } from "@/lib/criterios/validar";

// acceso-ac6: al confirmar el envío, enviarPlan navega con useRouter(); este
// componente no vive bajo un App Router real en el test, así que hace falta
// el doble de next/navigation que usan las convenciones de Next.js para
// pruebas unitarias de componentes cliente.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.localStorage.clear();
  // acceso-ac6: "Continuar" ya dispara POST /api/plan de verdad; este
  // archivo comprueba validación y persistencia del borrador, no la red, así
  // que se dobla con la respuesta real de un visitante sin sesión (401) en
  // vez de dejar que jsdom intente una petición de red que nunca resolverá.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: "no autenticado" }), { status: 401 })),
  );
});

describe("FormularioCriterios (acceso-ac2)", () => {
  it("valida sin tocar el alojamiento y restaura el estado tras recargar", async () => {
    const usuario = userEvent.setup();
    render(<FormularioCriterios />);

    await usuario.type(screen.getByLabelText("Destino o tipo de viaje"), "Sevilla");
    await usuario.type(screen.getByLabelText("Época del año"), "primavera");
    await usuario.click(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const borrador = leerBorrador();
    expect(borrador).not.toBeNull();
    expect(borrador?.alojamiento).toBeUndefined();
    expect(validarCriterios(borrador).valido).toBe(true);

    cleanup();
    render(<FormularioCriterios />);
    expect(await screen.findByDisplayValue("Sevilla")).toBeInTheDocument();
  });

  it("también valida cuando se aporta alojamiento", async () => {
    const usuario = userEvent.setup();
    render(<FormularioCriterios />);

    await usuario.type(screen.getByLabelText("Destino o tipo de viaje"), "Estocolmo");
    await usuario.type(screen.getByLabelText("Época del año"), "verano");
    await usuario.click(screen.getByLabelText("Ya tengo alojamiento reservado"));
    await usuario.type(screen.getByLabelText("Dirección del alojamiento"), "Calle falsa 123");
    await usuario.click(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const borrador = leerBorrador();
    expect(borrador?.alojamiento).toEqual({ direccion: "Calle falsa 123" });
    expect(validarCriterios(borrador).valido).toBe(true);
  });
});
