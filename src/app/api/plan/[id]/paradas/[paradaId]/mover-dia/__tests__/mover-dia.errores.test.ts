import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// arr-ac5: la ruta con la RPC doblada, sin base de datos. Solo se sustituyen
// los módulos de fuera; la ruta y sus mensajes son los reales.
const rpc = vi.fn();
const versionesEnLaHora = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/auth/sesion", () => ({ requireSesion: async () => ({ id: "u1", email: "u1@example.com" }) }));
vi.mock("@/lib/plan/propiedad", () => ({ exigirDuenyo: async () => ({ id: "t1" }) }));
vi.mock("@/lib/db/cliente", () => ({
  clienteServicio: () => {
    const consulta: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte"]) consulta[m] = () => consulta;
    consulta.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, count: versionesEnLaHora.n, error: null }).then(ok);
    return { from: () => consulta, rpc };
  },
}));

import { POST } from "../route";

async function pedir(cuerpo: unknown = { version_base: 3, dia_origen: 0, dia_destino: 1, franja_id: "manana" }) {
  const peticion = new NextRequest("http://localhost/api/plan/p1/paradas/a/mover-dia", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  return POST(peticion, { params: Promise.resolve({ id: "p1", paradaId: "a" }) } as never);
}

afterEach(() => {
  versionesEnLaHora.n = 0;
  rpc.mockReset();
  vi.restoreAllMocks();
});

describe("POST mover-dia: errores de la RPC (arr-ac5)", () => {
  it("un 23505 es un 409 version-desfasada y no se registra como 500", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ error: { code: "23505", message: "duplicate key value violates unique constraint" } });
    const r = await pedir();
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("version-desfasada");
    expect(consola).not.toHaveBeenCalled();
  });

  it("orden-invalido de la función es un 400; cualquier otro error, un 500 «interno» sin detalles", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ error: { code: "P0001", message: "orden-invalido" } });
    expect((await pedir()).status).toBe(400);
    rpc.mockResolvedValue({ error: { code: "42501", message: "permission denied for function" } });
    const r = await pedir();
    expect(r.status).toBe(500);
    const cuerpo = await r.json();
    expect(cuerpo.error).toBe("interno");
    expect(JSON.stringify(cuerpo)).not.toContain("permission denied");
  });

  it("un cuerpo que no es de la forma pedida es un 400 y no llega a la función", async () => {
    for (const cuerpo of [{}, { version_base: 0, dia_origen: 0, dia_destino: 1, franja_id: "m" }, { version_base: 1, dia_origen: -1, dia_destino: 1, franja_id: "m" }, { version_base: 1, dia_origen: 0, dia_destino: 1, franja_id: "" }, { version_base: 1, dia_origen: 0, dia_destino: 1, franja_id: "m", posicion: -2 }]) {
      expect((await pedir(cuerpo)).status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("manda a la función la posición solo cuando viene", async () => {
    rpc.mockResolvedValue({ data: [{ version: 4 }], error: null });
    await pedir();
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_posicion");
    await pedir({ version_base: 3, dia_origen: 0, dia_destino: 1, franja_id: "manana", posicion: 2 });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_posicion: 2, p_version_base: 3, p_parada_id: "a" });
  });

  // arr-ac3: el arreglo n.º 30 se aplica, así que su Deshacer necesita una versión reservada.
  it("con 30 versiones en la hora un arreglo da 429, pero su Deshacer cabe una vez más", async () => {
    versionesEnLaHora.n = 30;
    expect((await pedir()).status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({ data: [{ version: 32 }], error: null });
    const r = await pedir({ version_base: 31, dia_origen: 1, dia_destino: 0, franja_id: "manana", deshacer: true });
    expect(r.status).toBe(200);

    versionesEnLaHora.n = 31;
    expect((await pedir({ version_base: 32, dia_origen: 1, dia_destino: 0, franja_id: "manana", deshacer: true })).status).toBe(429);
  });

  it("deshacer que no es booleano es un 400", async () => {
    expect((await pedir({ version_base: 3, dia_origen: 0, dia_destino: 1, franja_id: "manana", deshacer: "si" })).status).toBe(400);
  });
});
