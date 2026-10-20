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

import { falsaCacheStorage } from "@/lib/sinConexion/__tests__/cacheFalsa";
import { guardarMapasPlan } from "@/lib/sinConexion/mapas";
import { MapaDia } from "@/app/plan/[id]/MapaDia";

const puntos = [{ id: "a", orden: 1, nombre: "Belém", lat: 38.7, lon: -9.2 }];

function fijarRed(enLinea: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: enLinea });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fijarRed(true);
});

describe("MapaDia sin conexión (sc-ac10)", () => {
  it("con la página ya sin red y el día sin guardar explica cómo guardarlo", async () => {
    fijarRed(false);
    render(<MapaDia puntos={puntos} />);
    expect(await screen.findByText(/Este día no está guardado para usar sin red/)).toBeTruthy();
    expect(screen.queryByTestId("mapa-falso")).toBeNull();
  });

  it("pasa a aviso al perder la red y vuelve al mapa al recuperarla", async () => {
    fijarRed(true);
    render(<MapaDia puntos={puntos} />);
    expect(screen.getByTestId("mapa-falso")).toBeTruthy();
    act(() => {
      fijarRed(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(await screen.findByText(/Este día no está guardado para usar sin red/)).toBeTruthy();
    act(() => {
      fijarRed(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByTestId("mapa-falso")).toBeTruthy();
  });

  it("con el día guardado y sin red pinta el mapa (p4m-ac2)", async () => {
    const cs = falsaCacheStorage();
    vi.stubGlobal("caches", cs);
    const base = "https://tiles.openfreemap.org";
    const peticion = (async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.endsWith("/styles/liberty")) return new Response(JSON.stringify({ sprite: `${base}/s/ofm`, sources: { o: { url: `${base}/planet` } } }));
      if (url.endsWith("/planet")) return new Response(JSON.stringify({ tiles: [`${base}/planet/v1/{z}/{x}/{y}.pbf`] }));
      return new Response("x");
    }) as typeof fetch;
    const r = await guardarMapasPlan({ id: "p", dias: [{ paradas: [{ coordenadas: { lat: 38.7, lon: -9.2 } }] }] }, { peticion });
    expect(r.guardados).toEqual([1]);
    fijarRed(false);
    render(<MapaDia puntos={puntos} />);
    expect(await screen.findByTestId("mapa-falso")).toBeTruthy();
    expect(screen.queryByText(/no está guardado/)).toBeNull();
  });
});
