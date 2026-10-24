// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useArreglos } from "@/app/plan/[id]/useArreglos";
import type { PlanPublico } from "@/app/plan/[id]/tiposVista";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const franjas = [
  { id: "manana", etiqueta: "Mañana" },
  { id: "tarde", etiqueta: "Tarde" },
];
const parada = (id: string, franja: string) => ({ id, franja_id: franja, nombre: `Sitio ${id}`, descripcion: "d", procedencia: { fuente: "osm" }, horario: { inicio: "10:00", fin: "11:00", recortada: false } });

function plan(version: number, lunes: string[], martes: string[]): PlanPublico {
  return {
    id: "plan-1",
    version,
    destino: "Roma",
    dias: [
      { fecha: "2026-11-16", franjas, paradas: lunes.map((id) => parada(id, "manana")) },
      { fecha: "2026-11-17", franjas, paradas: martes.map((id) => parada(id, "manana")) },
    ],
  } as unknown as PlanPublico;
}

const INICIAL = plan(1, ["a", "b"], ["c"]);

function montar() {
  return renderHook(() => {
    const [actual, fijar] = useState(INICIAL);
    return { ...useArreglos(actual, fijar), plan: actual };
  });
}

function respuesta(status: number, cuerpo: unknown = {}) {
  return Promise.resolve(new Response(JSON.stringify(cuerpo), { status }));
}

const OTRO_DIA = { tipo: "otro-dia", diaDestino: 1, franjaId: "manana", etiqueta: "x" } as const;

describe("useArreglos: otro día (arr-ac1, arr-ac3)", () => {
  it("pinta el cambio, manda la petición, relee el plan y ofrece Deshacer", async () => {
    const servidor = plan(2, ["b"], ["c", "a"]);
    const fetchFalso = vi.fn((url: string, init?: RequestInit) => (init?.method === "POST" ? respuesta(200, { version: 2 }) : respuesta(200, servidor)));
    vi.stubGlobal("fetch", fetchFalso);
    const { result } = montar();
    await act(async () => {
      await result.current.aplicar(OTRO_DIA, "a", 0);
    });
    const [urlPost, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(urlPost).toBe("/api/plan/plan-1/paradas/a/mover-dia");
    expect(JSON.parse(init.body as string)).toEqual({ version_base: 1, dia_origen: 0, dia_destino: 1, franja_id: "manana" });
    expect(result.current.plan.version).toBe(2);
    expect(result.current.aviso).toEqual({ texto: "Movida al martes 17", conDeshacer: true });
    expect(result.current.error).toBeNull();
  });

  it("Deshacer manda el movimiento inverso con la posición original", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => (init?.method === "POST" ? respuesta(200, { version: 2 }) : respuesta(200, plan(2, ["b"], ["c", "a"])))));
    const { result } = montar();
    await act(async () => {
      await result.current.aplicar(OTRO_DIA, "a", 0);
    });
    const fetchDeshacer = vi.fn((_url: string, init?: RequestInit) => (init?.method === "POST" ? respuesta(200, { version: 3 }) : respuesta(200, plan(3, ["a", "b"], ["c"]))));
    vi.stubGlobal("fetch", fetchDeshacer);
    act(() => result.current.deshacer());
    await waitFor(() => expect(result.current.aviso?.texto).toBe("Parada restaurada"));
    const [url, init] = fetchDeshacer.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/plan/plan-1/paradas/a/mover-dia");
    expect(JSON.parse(init.body as string)).toEqual({ version_base: 2, dia_origen: 1, dia_destino: 0, franja_id: "manana", posicion: 0 });
    expect(result.current.aviso?.conDeshacer).toBe(false);
  });
});

describe("useArreglos: fallos (arr-ac5)", () => {
  it("un 500 deja el plan como estaba y lo dice", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respuesta(500, { error: "interno" })));
    const { result } = montar();
    await act(async () => {
      await result.current.aplicar(OTRO_DIA, "a", 0);
    });
    expect(result.current.plan).toBe(INICIAL);
    expect(result.current.error).toContain("No se ha podido mover la parada");
    expect(result.current.aviso).toBeNull();
  });

  it("un fallo de red deja el plan como estaba y lo dice", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const { result } = montar();
    await act(async () => {
      await result.current.aplicar(OTRO_DIA, "a", 0);
    });
    expect(result.current.plan).toBe(INICIAL);
    expect(result.current.error).toContain("Comprueba la conexión");
  });

  it("un 409 avisa de que el plan cambió y carga la versión nueva", async () => {
    const nuevo = plan(5, ["a"], ["b", "c"]);
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => (init?.method === "POST" ? respuesta(409, { error: "version-desfasada" }) : respuesta(200, nuevo))));
    const { result } = montar();
    await act(async () => {
      await result.current.aplicar(OTRO_DIA, "a", 0);
    });
    expect(result.current.error).toContain("El plan ha cambiado");
    expect(result.current.plan.version).toBe(5);
  });

  it("un 429 enseña el mensaje del tope", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respuesta(429, { error: "demasiados-cambios" })));
    const { result } = montar();
    await act(async () => {
      await result.current.aplicar(OTRO_DIA, "a", 0);
    });
    expect(result.current.plan).toBe(INICIAL);
    expect(result.current.error).toContain("muchas veces");
  });
});

describe("useArreglos: otra franja y alternativa", () => {
  it("otra franja usa /orden con la parada ya en su franja", async () => {
    const fetchFalso = vi.fn((_url: string, init?: RequestInit) => (init?.method === "POST" ? respuesta(200, {}) : respuesta(200, plan(2, ["b", "a"], ["c"]))));
    vi.stubGlobal("fetch", fetchFalso);
    const { result } = montar();
    await act(async () => {
      await result.current.aplicar({ tipo: "otra-franja", diaIndex: 0, franjaId: "tarde", etiqueta: "x" }, "a", 0);
    });
    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/plan/plan-1/orden");
    expect(JSON.parse(init.body as string).orden).toEqual([
      { id: "b", franja_id: "manana" },
      { id: "a", franja_id: "tarde" },
    ]);
    expect(result.current.aviso?.texto).toBe("Movida a la tarde");
  });

  it("alternativa usa /sustituir y Deshacer vuelve a la parada original", async () => {
    const conAlternativa = plan(1, ["a", "b"], ["c"]);
    (conAlternativa.dias[0].paradas[0] as unknown as { alternativas: unknown[] }).alternativas = [{ id: "alt1", nombre: "Museo B" }];
    const tras = plan(2, ["a", "b"], ["c"]);
    (tras.dias[0].paradas[0] as unknown as { nombre: string; alternativas: unknown[] }).nombre = "Museo B";
    (tras.dias[0].paradas[0] as unknown as { alternativas: unknown[] }).alternativas = [{ id: "alt0", nombre: "Sitio a" }];
    const fetchFalso = vi.fn((_url: string, init?: RequestInit) => (init?.method === "POST" ? respuesta(200, {}) : respuesta(200, tras)));
    vi.stubGlobal("fetch", fetchFalso);
    const { result } = renderHook(() => {
      const [actual, fijar] = useState(conAlternativa);
      return { ...useArreglos(actual, fijar), plan: actual };
    });
    await act(async () => {
      await result.current.aplicar({ tipo: "alternativa", alternativaId: "alt1", etiqueta: "x" }, "a", 0);
    });
    expect(JSON.parse((fetchFalso.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ alternativa_id: "alt1" });
    expect(result.current.aviso).toEqual({ texto: "Cambiada por Museo B", conDeshacer: true });
    fetchFalso.mockClear();
    act(() => result.current.deshacer());
    await waitFor(() => expect(fetchFalso).toHaveBeenCalled());
    expect(JSON.parse((fetchFalso.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ alternativa_id: "alt0" });
  });
});
