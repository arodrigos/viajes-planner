import fc from "fast-check";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const marcarObsoleto = vi.fn();
const registrarObsoleto = vi.fn();

vi.mock("@/lib/auth/sesion", () => ({ requireSesion: async () => ({ usuarioId: "u-1" }) }));
vi.mock("@/lib/db/cliente", () => ({ clienteServicio: () => ({}) }));
vi.mock("@/lib/plan/propiedad", () => ({ exigirDuenyo: async () => ({ id: "trabajo-1" }) }));
vi.mock("@/lib/google/cupo", () => ({ conCupo: vi.fn() }));
vi.mock("@/lib/google/ficha", () => ({
  buscarFicha: async () => ({ tipo: "ficha", clave: "osm:node/1", placeId: "ChIJ-x" }),
  marcarObsoleto: (...args: unknown[]) => marcarObsoleto(...args),
}));
vi.mock("@/lib/google/obsoleto", () => ({ registrarObsoleto: (...args: unknown[]) => registrarObsoleto(...args) }));

import { POST } from "../route";

const peticion = () =>
  new NextRequest("http://localhost/api/google/ficha", {
    method: "POST",
    body: JSON.stringify({ planId: "p", paradaId: "x", obsoleto: true }),
    headers: { "content-type": "application/json" },
  });

describe("POST /api/google/ficha con obsoleto=true (obs-ac5)", () => {
  beforeEach(() => {
    marcarObsoleto.mockReset();
    registrarObsoleto.mockReset();
  });

  it("con 'ok' marca y responde 200", async () => {
    registrarObsoleto.mockResolvedValue("ok");
    const r = await POST(peticion());
    expect(r.status).toBe(200);
    expect(marcarObsoleto).toHaveBeenCalledTimes(1);
  });

  it.each(["repetido", "tope-usuario"] as const)("con '%s' responde 429 limite-obsoleto sin marcar", async (resultado) => {
    registrarObsoleto.mockResolvedValue(resultado);
    const r = await POST(peticion());
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ motivo: "limite-obsoleto" });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(marcarObsoleto).not.toHaveBeenCalled();
  });

  it("si la función falla responde 503 no-disponible sin marcar", async () => {
    registrarObsoleto.mockResolvedValue("error");
    const r = await POST(peticion());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ motivo: "no-disponible" });
    expect(marcarObsoleto).not.toHaveBeenCalled();
  });

  it("invariante: marcarObsoleto se llama solo cuando el resultado fue 'ok'", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("ok", "repetido", "tope-usuario", "error"), async (resultado) => {
        marcarObsoleto.mockReset();
        registrarObsoleto.mockResolvedValue(resultado);
        await POST(peticion());
        expect(marcarObsoleto).toHaveBeenCalledTimes(resultado === "ok" ? 1 : 0);
      }),
      { numRuns: 20 },
    );
  });
});
