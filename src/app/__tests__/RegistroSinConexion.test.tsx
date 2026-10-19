// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RegistroSinConexion from "@/app/RegistroSinConexion";

const registrar = vi.fn(async () => ({}));
const desregistrar = vi.fn(async () => true);
let cachesBorradas: string[];

beforeEach(() => {
  registrar.mockClear();
  desregistrar.mockClear();
  cachesBorradas = [];
  vi.stubGlobal("navigator", {
    serviceWorker: { register: registrar, getRegistrations: async () => [{ unregister: desregistrar }, { unregister: desregistrar }] },
  });
  vi.stubGlobal("caches", {
    keys: async () => ["viajes-datos", "viajes-fotos", "serwist-precache-v2-https://x/", "otra-cosa"],
    delete: async (nombre: string) => {
      cachesBorradas.push(nombre);
      return true;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("RegistroSinConexion", () => {
  it("registra /sw.js sin dejar que el navegador lo cachee (pwa-ac1)", async () => {
    render(<RegistroSinConexion />);
    await waitFor(() => expect(registrar).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" }));
  });

  it("con NEXT_PUBLIC_SW_DESACTIVADO=1 no registra, desregistra y borra las cachés propias (pwa-ac4)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SW_DESACTIVADO", "1");
    render(<RegistroSinConexion />);
    await waitFor(() => expect(cachesBorradas).toHaveLength(3));
    expect(registrar).not.toHaveBeenCalled();
    expect(desregistrar).toHaveBeenCalledTimes(2);
    expect(cachesBorradas.sort()).toEqual(["serwist-precache-v2-https://x/", "viajes-datos", "viajes-fotos"]);
  });

  it("un fallo al registrar no rompe la página", async () => {
    registrar.mockRejectedValueOnce(new Error("sw.js caído"));
    expect(() => render(<RegistroSinConexion />)).not.toThrow();
    await waitFor(() => expect(registrar).toHaveBeenCalled());
  });

  it("sin soporte de service worker no hace nada", () => {
    vi.stubGlobal("navigator", {});
    expect(() => render(<RegistroSinConexion />)).not.toThrow();
    expect(registrar).not.toHaveBeenCalled();
  });
});
