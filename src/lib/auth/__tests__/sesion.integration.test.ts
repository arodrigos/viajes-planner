import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { requireSesion } from "@/lib/auth/sesion";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("requireSesion (acceso-ac1)", () => {
  it("devuelve 401 cuando no hay cookies de sesión", async () => {
    const request = new NextRequest("http://localhost/api/plan", { method: "POST" });
    const resultado = await requireSesion(request);
    expect(resultado).toBeInstanceOf(Response);
    expect((resultado as Response).status).toBe(401);
  });
});
