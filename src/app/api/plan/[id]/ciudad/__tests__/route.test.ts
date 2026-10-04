import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST } from "../route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function contexto(id: string) {
  return { params: Promise.resolve({ id }) };
}

function peticion() {
  return new NextRequest("http://localhost/api/plan/x/ciudad", {
    method: "POST",
    body: JSON.stringify({ nombre: "Valencia" }),
  });
}

// man-ac4: la autorización real (404 ajeno/inexistente/eliminado, 429
// demasiado pronto) se prueba contra la pila real en
// route.integration.test.ts -- aquí solo la puerta de sesión, mismo patrón
// que regenerar/__tests__/route.test.ts.
describe.skipIf(!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY)("POST /api/plan/[id]/ciudad (man-ac4)", () => {
  it("sin sesión responde 401 sin Set-Cookie", async () => {
    const respuesta = await POST(peticion(), contexto("00000000-0000-0000-0000-000000000000"));
    expect(respuesta.status).toBe(401);
    expect(respuesta.headers.get("set-cookie")).toBeNull();
  });
});
