import { NextRequest } from "next/server";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

// orc-ac2: la ruta con la RPC doblada, sin base de datos. Los cuatro módulos
// de fuera son lo único que se sustituye; la ruta y sus mensajes son los reales.
const rpc = vi.fn();
vi.mock("@/lib/auth/sesion", () => ({ requireSesion: async () => ({ id: "u1", email: "u1@example.com" }) }));
vi.mock("@/lib/plan/propiedad", () => ({ exigirDuenyo: async () => ({ id: "t1" }) }));
vi.mock("@/lib/plan/repositorio", () => ({ recuperarPlan: async () => null }));
vi.mock("@/lib/db/cliente", () => ({
  clienteServicio: () => {
    // Cadena mínima de PostgREST: cada consulta devuelve lo que la ruta lee.
    const consulta = (datos: unknown, count: number | null = null) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "order", "limit"]) c[m] = () => c;
      c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: datos, count, error: null }).then(ok);
      return c;
    };
    return {
      from: (tabla: string) =>
        tabla === "plan_versiones"
          ? { select: (_cols: string, opciones?: { head?: boolean }) => consulta(opciones?.head ? null : [{ id: "v3", version: 3, dias: [{ franjas: [{ id: "manana" }] }] }], 0) }
          : { select: () => consulta([{ id_externo: "a", franja_id: "manana" }, { id_externo: "b", franja_id: "manana" }]) },
      rpc,
    };
  },
}));

import { POST } from "../manejador";

const MENSAJE = "El plan se acaba de actualizar mientras guardabas. Hemos cargado la versión más reciente; vuelve a ordenar si lo necesitas.";

async function pedir() {
  const peticion = new NextRequest("http://localhost/api/plan/p1/orden", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version_base: 3, dia_index: 0, orden: [{ id: "b", franja_id: "manana" }, { id: "a", franja_id: "manana" }] }),
  });
  return POST(peticion, { params: Promise.resolve({ id: "p1" }) } as never);
}

afterEach(() => {
  rpc.mockReset();
  vi.restoreAllMocks();
});

describe("POST /api/plan/[id]/orden: errores de la RPC (orc-ac2)", () => {
  it("un 23505 es un 409 version-desfasada con el mensaje del contrato y no se registra como 500", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ error: { code: "23505", message: 'duplicate key value violates unique constraint "plan_versiones_plan_id_version_key"' } });
    const r = await pedir();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "version-desfasada", mensaje: MENSAJE });
    expect(consola).not.toHaveBeenCalled();
  });

  it("otro code sigue dando 500 «interno»; orden-invalido sigue dando 400", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ error: { code: "42501", message: "permission denied for function" } });
    const interno = await pedir();
    expect(interno.status).toBe(500);
    expect((await interno.json()).error).toBe("interno");

    rpc.mockResolvedValue({ error: { code: "P0001", message: "orden-invalido" } });
    expect((await pedir()).status).toBe(400);
  });

  it("propiedad: para cualquier mensaje con code 23505 la respuesta es 409, nunca 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 200 }), async (message) => {
        rpc.mockResolvedValue({ error: { code: "23505", message } });
        const r = await pedir();
        expect(r.status).toBe(409);
        expect((await r.json()).error).toBe("version-desfasada");
      }),
      { numRuns: 50 },
    );
  });
});
