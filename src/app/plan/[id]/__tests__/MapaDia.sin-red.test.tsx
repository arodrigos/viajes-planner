// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// maplibre necesita WebGL: aquí solo importa si MapaDia monta el mapa o el aviso.
vi.mock("maplibre-gl", () => ({ setWorkerUrl: () => undefined }));
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("@vis.gl/react-maplibre", () => ({
  Map: () => <div data-testid="mapa-falso" />,
  AttributionControl: () => null,
  Layer: () => null,
  Source: () => null,
  Marker: () => null,
}));

import { MapaDia } from "@/app/plan/[id]/MapaDia";

const puntos = [{ id: "a", orden: 1, nombre: "Belém", lat: 38.7, lon: -9.2 }];

function fijarRed(enLinea: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: enLinea });
}

afterEach(() => {
  cleanup();
  fijarRed(true);
});

describe("MapaDia sin conexión (sc-ac10)", () => {
  it("con la página ya sin red enseña el aviso desde el primer pintado", () => {
    fijarRed(false);
    render(<MapaDia puntos={puntos} />);
    expect(screen.getByText("El mapa no está disponible ahora.")).toBeTruthy();
    expect(screen.queryByTestId("mapa-falso")).toBeNull();
  });

  it("pasa a aviso al perder la red y vuelve al mapa al recuperarla", () => {
    fijarRed(true);
    render(<MapaDia puntos={puntos} />);
    expect(screen.getByTestId("mapa-falso")).toBeTruthy();
    act(() => {
      fijarRed(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText("El mapa no está disponible ahora.")).toBeTruthy();
    act(() => {
      fijarRed(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByTestId("mapa-falso")).toBeTruthy();
  });
});
