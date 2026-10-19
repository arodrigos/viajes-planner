// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanPublico } from "../tiposVista";
import { ESPERA_AGRUPAR_MS, TEXTOS_ORDEN, useOrdenDia } from "../useOrdenDia";

// Solo los campos que lee el hook; el resto del plan no importa aquí.
function planCon(version: number, ids: string[]): PlanPublico {
  return {
    id: "plan-1",
    version,
    dias: [
      {
        franjas: [{ id: "f0" }],
        paradas: ids.map((id) => ({ id, franja_id: "f0" })),
      },
    ],
  } as unknown as PlanPublico;
}

function respuesta(status: number, cuerpo: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => cuerpo };
}

describe("useOrdenDia (reo-ac3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("una ráfaga de pulsaciones hace un solo POST con el orden final", async () => {
    const guardado = planCon(2, ["B", "C", "A"]);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? respuesta(200, { plan: guardado }) : respuesta(200, guardado),
    );
    vi.stubGlobal("fetch", fetchMock);
    const alActualizar = vi.fn();
    const { result } = renderHook(() => useOrdenDia(planCon(1, ["A", "B", "C"]), alActualizar));

    act(() => result.current.mover(0, "A", "abajo"));
    act(() => result.current.mover(0, "A", "abajo"));
    act(() => result.current.mover(0, "A", "abajo"));
    expect(result.current.ordenEnPantalla(0).map((e) => e.id)).toEqual(["B", "C", "A"]);
    expect(result.current.recalculando(0)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESPERA_AGRUPAR_MS + 10);
    });

    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0][1]!.body as string)).toEqual({
      version_base: 1,
      dia_index: 0,
      orden: [
        { id: "B", franja_id: "f0" },
        { id: "C", franja_id: "f0" },
        { id: "A", franja_id: "f0" },
      ],
    });
    expect(alActualizar).toHaveBeenCalledWith(guardado);
    expect(result.current.aviso).toEqual({ texto: TEXTOS_ORDEN.guardado, conDeshacer: true });
  });

  it("un fallo de red revierte el orden, avisa y Reintentar vuelve a enviar lo mismo", async () => {
    let fallar = true;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return respuesta(200, planCon(2, ["B", "A"]));
      if (fallar) throw new TypeError("offline");
      return respuesta(200, { plan: planCon(2, ["B", "A"]) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useOrdenDia(planCon(1, ["A", "B"]), vi.fn()));

    act(() => result.current.mover(0, "A", "abajo"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESPERA_AGRUPAR_MS + 10);
    });
    expect(result.current.estado).toBe("error");
    expect(result.current.mensaje).toBe(TEXTOS_ORDEN.errorRed);
    expect(result.current.ordenEnPantalla(0).map((e) => e.id)).toEqual(["A", "B"]);

    fallar = false;
    await act(async () => {
      result.current.reintentar();
      await vi.advanceTimersByTimeAsync(10);
    });
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[1][1]!.body).toBe(posts[0][1]!.body);
    expect(result.current.estado).toBe("guardado");
  });

  it("409 y 429 muestran su texto y no dejan el orden pendiente", async () => {
    for (const [status, texto] of [
      [409, TEXTOS_ORDEN.desfasada],
      [429, TEXTOS_ORDEN.demasiados],
    ] as const) {
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST" ? respuesta(status, {}) : respuesta(200, planCon(3, ["A", "B"])),
      );
      vi.stubGlobal("fetch", fetchMock);
      const { result, unmount } = renderHook(() => useOrdenDia(planCon(1, ["A", "B"]), vi.fn()));
      act(() => result.current.mover(0, "A", "abajo"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ESPERA_AGRUPAR_MS + 10);
      });
      expect(result.current.mensaje).toBe(texto);
      expect(result.current.recalculando(0)).toBe(false);
      unmount();
    }
  });
});
