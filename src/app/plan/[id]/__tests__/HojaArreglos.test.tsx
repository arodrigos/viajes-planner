// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HojaArreglos } from "@/app/plan/[id]/HojaArreglos";
import type { ArregloPropuesto } from "@/lib/plan/arreglos";

afterEach(cleanup);

const OPCIONES: ArregloPropuesto[] = [
  { tipo: "otra-franja", diaIndex: 0, franjaId: "tarde", etiqueta: "Pasar a la tarde: abre de 10:00 a 18:00" },
  { tipo: "otro-dia", diaDestino: 1, franjaId: "manana", etiqueta: "Llevar al martes: abre de 10:00 a 18:00" },
  { tipo: "alternativa", alternativaId: "alt1", etiqueta: "Cambiar por Museo B: abre de 09:00 a 20:00" },
];

function pintar(opciones: ArregloPropuesto[], extra: { onElegir?: (a: ArregloPropuesto) => void; onCerrar?: () => void } = {}) {
  return render(<HojaArreglos nombreParada="Museo A" opciones={opciones} onElegir={extra.onElegir ?? (() => undefined)} onCerrar={extra.onCerrar ?? (() => undefined)} />);
}

describe("HojaArreglos (arr-ac1, arr-ac2)", () => {
  it("con tres opciones enseña las tres, cada una con su motivo, y «Dejarla como está»", () => {
    pintar(OPCIONES);
    expect(screen.getByRole("dialog", { name: "Arreglar Museo A" })).toBeTruthy();
    for (const o of OPCIONES) expect(screen.getByRole("button", { name: o.etiqueta })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dejarla como está" })).toBeTruthy();
    expect(screen.queryByTestId("hoja-sin-opciones")).toBeNull();
  });

  it("con una sola opción enseña solo esa", () => {
    pintar([OPCIONES[0]]);
    expect(screen.getAllByTestId(/^arreglo-(?!dejarla)/)).toHaveLength(1);
  });

  it("sin opciones lo dice y deja solo «Dejarla como está»", () => {
    pintar([]);
    expect(screen.getByTestId("hoja-sin-opciones").textContent).toContain("No hay otra franja ni otro día en que abra");
    expect(screen.queryAllByTestId(/^arreglo-(?!dejarla)/)).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Dejarla como está" })).toBeTruthy();
  });

  it("elegir una opción la entrega; «Dejarla» y Escape cierran sin elegir", () => {
    const onElegir = vi.fn();
    const onCerrar = vi.fn();
    pintar(OPCIONES, { onElegir, onCerrar });
    fireEvent.click(screen.getByTestId("arreglo-otro-dia"));
    expect(onElegir).toHaveBeenCalledWith(OPCIONES[1]);
    fireEvent.click(screen.getByTestId("arreglo-dejarla"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCerrar).toHaveBeenCalledTimes(2);
    expect(onElegir).toHaveBeenCalledTimes(1);
  });
});
