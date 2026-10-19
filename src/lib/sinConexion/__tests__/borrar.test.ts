// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { borrarCopiaPlan, borrarCopias } from "../borrar";

// Cache API mínima en memoria: jsdom no la trae y lo que se prueba es qué
// nombres y claves se tocan, no el navegador.
function falsaCacheStorage(inicial: Record<string, string[]>) {
  const almacen = new Map(Object.entries(inicial).map(([n, urls]) => [n, new Set(urls)]));
  return {
    almacen,
    has: async (n: string) => almacen.has(n),
    delete: async (n: string) => almacen.delete(n),
    open: async (n: string) => ({
      delete: async (url: string) => almacen.get(n)?.delete(url) ?? false,
      keys: async () => [...(almacen.get(n) ?? [])],
    }),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("borrarCopias (ses-ac1, ses-ac2)", () => {
  it("elimina viajes-datos y viajes-fotos y deja el resto", async () => {
    const cs = falsaCacheStorage({ "viajes-datos": ["a"], "viajes-fotos": ["b"], otra: ["c"] });
    vi.stubGlobal("caches", cs);
    await borrarCopias();
    expect([...cs.almacen.keys()]).toEqual(["otra"]);
  });

  it("no lanza si la Cache API falla o no existe", async () => {
    vi.stubGlobal("caches", { delete: async () => Promise.reject(new Error("cuota")) });
    await expect(borrarCopias()).resolves.toBeUndefined();
    vi.stubGlobal("caches", undefined);
    await expect(borrarCopias()).resolves.toBeUndefined();
  });
});

describe("borrarCopiaPlan (ses-ac3)", () => {
  it("quita solo el JSON del plan indicado", async () => {
    const mio = `${location.origin}/api/plan/plan-1`;
    const otro = `${location.origin}/api/plan/plan-2`;
    const cs = falsaCacheStorage({ "viajes-datos": [mio, otro], "viajes-fotos": ["f"] });
    vi.stubGlobal("caches", cs);
    await borrarCopiaPlan("plan-1");
    expect([...(cs.almacen.get("viajes-datos") ?? [])]).toEqual([otro]);
    expect(cs.almacen.has("viajes-fotos")).toBe(true);
  });

  it("sin caché de datos no crea nada", async () => {
    const cs = falsaCacheStorage({});
    vi.stubGlobal("caches", cs);
    await borrarCopiaPlan("plan-1");
    expect(cs.almacen.size).toBe(0);
  });
});
