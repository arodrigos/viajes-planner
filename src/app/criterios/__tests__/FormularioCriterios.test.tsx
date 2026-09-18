// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FormularioCriterios } from "@/app/criterios/FormularioCriterios";
import { leerBorrador } from "@/lib/criterios/borrador";
import { validarCriterios } from "@/lib/criterios/validar";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("FormularioCriterios (criterios-ac1)", () => {
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
