// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { falsaCacheStorage } from "@/lib/sinConexion/__tests__/cacheFalsa";
import { GuardarMapas } from "../GuardarMapas";

const plan = {
  id: "p1",
  dias: [{ paradas: [{ coordenadas: { lat: 38.7, lon: -9.2 } }] }, { paradas: [{ coordenadas: { lat: 38.71, lon: -9.1 } }] }],
};
const BASE = "https://tiles.openfreemap.org";

function servidor(estadoTesela = 200) {
  return vi.fn(async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    if (url.endsWith("/styles/liberty")) return new Response(JSON.stringify({ sprite: `${BASE}/s/ofm`, sources: { o: { url: `${BASE}/planet` } } }));
    if (url.endsWith("/planet")) return new Response(JSON.stringify({ tiles: [`${BASE}/planet/v/{z}/{x}/{y}.pbf`] }));
    if (url.endsWith(".pbf") && estadoTesela !== 200) return new Response("", { status: estadoTesela });
    return new Response("x");
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GuardarMapas (p4m-ac1, p4m-ac4)", () => {
  it("al pulsar enseña «Calculando…» enseguida y al acabar el aviso de días guardados", async () => {
    vi.stubGlobal("caches", falsaCacheStorage());
    vi.stubGlobal("fetch", servidor());
    render(<GuardarMapas planId={plan.id} dias={plan.dias} />);
    expect(screen.getByText(/Se descargan en este dispositivo los mapas de 2 días/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Guardar mapas para usar sin red" }));
    expect(screen.getByText("Calculando…")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Guardado para usar sin red: días 1 y 2 \(≈\d+ MB\)/)).toBeTruthy());
  });

  it("ante un 429 dice que el servidor pidió parar y no marca ningún día", async () => {
    vi.stubGlobal("caches", falsaCacheStorage());
    vi.stubGlobal("fetch", servidor(429));
    render(<GuardarMapas planId={plan.id} dias={plan.dias} />);
    fireEvent.click(screen.getByRole("button", { name: "Guardar mapas para usar sin red" }));
    await waitFor(() => expect(screen.getByText(/El servidor de mapas ha pedido parar; inténtalo más tarde/)).toBeTruthy());
    expect(screen.queryByText(/Guardado para usar sin red/)).toBeNull();
  });

  it("sin red no ofrece el botón y abrirlo no descarga nada", () => {
    vi.stubGlobal("caches", falsaCacheStorage());
    const peticion = servidor();
    vi.stubGlobal("fetch", peticion);
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    render(<GuardarMapas planId={plan.id} dias={plan.dias} />);
    expect(screen.queryByRole("button", { name: /Guardar mapas/ })).toBeNull();
    expect(peticion).not.toHaveBeenCalled();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  });
});
