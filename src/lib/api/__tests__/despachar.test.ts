import { NextRequest } from "next/server";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { casar, despachar, type Tabla } from "../despachar";

const get = vi.fn(async (_r: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Response.json(await ctx.params));
const tabla: Tabla = [
  { patron: "/api/plan/[id]/gastos", modulo: async () => ({ GET: get, POST: get }) },
  { patron: "/api/plan/[id]/gastos/[gastoId]", modulo: async () => ({ GET: get }) },
];
const pet = (ruta: string) => new NextRequest(`http://x.test${ruta}`);

describe("despachar", () => {
  it("invoca el manejador con los parámetros de la ruta", async () => {
    const r = await despachar(tabla, pet("/api/plan/p1/gastos/g%201"), "GET");
    expect(await r.json()).toEqual({ id: "p1", gastoId: "g 1" });
  });
  it("404 si ninguna ruta casa y 405 con Allow si el método no existe", async () => {
    expect((await despachar(tabla, pet("/api/plan/p1/no-existe"), "GET")).status).toBe(404);
    expect((await despachar(tabla, pet("/api/plan/p1/gastos/g1"), "DELETE")).status).toBe(405);
    const r = await despachar(tabla, pet("/api/plan/p1/gastos/g1"), "POST");
    expect(r.headers.get("Allow")).toBe("GET");
  });
  it("un parámetro vacío o mal codificado no casa", () => {
    expect(casar("/api/plan/[id]/gastos", "/api/plan//gastos")).toBeNull();
    expect(casar("/api/plan/[id]/gastos", "/api/plan/%E0%A4%A/gastos")).toBeNull();
  });
  it("invariante: casar devuelve el mismo id que se puso en la ruta", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }).filter((s) => !s.includes("/")), (id) => {
        expect(casar("/api/plan/[id]/gastos", `/api/plan/${encodeURIComponent(id)}/gastos`)).toEqual({ id });
      }),
    );
  });
});
