// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import fc from "fast-check";
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

// cam-ac2: el servidor se cae o no responde: el viajero no tiene nada que
// corregir, y sus datos tienen que seguir en el formulario.
describe("FormularioCriterios: errores de envío (cam-ac2)", () => {
  const FALLO = /fallo nuestro/;

  async function enviarConRespuesta(respuesta: () => Promise<Response>) {
    vi.stubGlobal("fetch", vi.fn(respuesta));
    const usuario = userEvent.setup();
    render(<FormularioCriterios />);
    await usuario.type(screen.getByLabelText("Destino o tipo de viaje"), "Sevilla");
    await usuario.type(screen.getByLabelText("Época del año"), "primavera");
    await usuario.click(screen.getByRole("button", { name: "Continuar" }));
  }

  it.each([500, 503])("un %i enseña el fallo nuestro y conserva el destino", async (estado) => {
    await enviarConRespuesta(async () => new Response("{}", { status: estado }));
    expect(await screen.findByText(FALLO)).toBeTruthy();
    expect(screen.queryByText(/no son válidos|no válidos/i)).toBeNull();
    expect((screen.getByLabelText("Destino o tipo de viaje") as HTMLInputElement).value).toBe("Sevilla");
  });

  it("un fallo de red enseña el fallo nuestro", async () => {
    await enviarConRespuesta(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await screen.findByText(FALLO)).toBeTruthy();
    expect(screen.queryByText(/no son válidos|no válidos/i)).toBeNull();
  });

  it("un 400 enseña los mensajes por campo del servidor", async () => {
    await enviarConRespuesta(
      async () =>
        new Response(JSON.stringify({ error: "criterios inválidos", detalle: ["/dias debe ser >= 1"] }), { status: 400 }),
    );
    expect(await screen.findByText("/dias debe ser >= 1")).toBeTruthy();
    expect(screen.queryByText(FALLO)).toBeNull();
  });
});

// cam-ac2, invariante: ningún 5xx ni fallo de red muestra «criterios no válidos».
describe("FormularioCriterios: invariante de errores del servidor (cam-ac2)", () => {
  it("para cualquier estado ≥ 500 o fallo de red no aparece «no válidos»", async () => {
    await fc.assert(
      fc.asyncProperty(fc.option(fc.integer({ min: 500, max: 599 }), { nil: null }), async (estado) => {
        cleanup();
        window.localStorage.clear();
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => {
            if (estado === null) throw new TypeError("fetch failed");
            return new Response("{}", { status: estado });
          }),
        );
        const usuario = userEvent.setup();
        render(<FormularioCriterios />);
        await usuario.type(screen.getByLabelText("Destino o tipo de viaje"), "Sevilla");
        await usuario.type(screen.getByLabelText("Época del año"), "primavera");
        await usuario.click(screen.getByRole("button", { name: "Continuar" }));
        expect(await screen.findByText(/fallo nuestro/)).toBeInTheDocument();
        expect(screen.queryByText(/no válidos|no son válidos/i)).toBeNull();
      }),
      { numRuns: 8 },
    );
  });
});
