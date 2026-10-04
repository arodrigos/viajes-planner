import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { DELETE, POST } from "../route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function contexto(id: string) {
  return { params: Promise.resolve({ id }) };
}

function peticion(metodo: "POST" | "DELETE", cuerpo: unknown) {
  return new NextRequest("http://localhost/api/plan/x/visitas", {
    method: metodo,
    body: JSON.stringify(cuerpo),
    headers: { "content-type": "application/json" },
  });
}

// dest-ac1: la autorización real (404 de plan ajeno) y el flujo completo
// de marcar/desmarcar se prueban contra la pila real en
// route.integration.test.ts -- este test solo cubre la puerta de sesión,
// mismo patrón que sustituir/__tests__/route.test.ts.
describe.skipIf(!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY)("POST|DELETE /api/plan/[id]/visitas (dest-ac1)", () => {
  it("sin sesión, POST responde 401", async () => {
    const respuesta = await POST(peticion("POST", { parada_id: "x" }), contexto("00000000-0000-0000-0000-000000000000"));
    expect(respuesta.status).toBe(401);
  });

  it("sin sesión, DELETE responde 401", async () => {
    const respuesta = await DELETE(peticion("DELETE", { parada_id: "x" }), contexto("00000000-0000-0000-0000-000000000000"));
    expect(respuesta.status).toBe(401);
  });
});
