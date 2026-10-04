import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST } from "../route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function contexto(id: string, paradaId: string) {
  return { params: Promise.resolve({ id, paradaId }) };
}

function peticion(cuerpo: unknown) {
  return new NextRequest("http://localhost/api/plan/x/paradas/y/sustituir", {
    method: "POST",
    body: JSON.stringify(cuerpo),
    headers: { "content-type": "application/json" },
  });
}

// alt-ac6: la autorización y el aislamiento de datos ajenos se prueban de
// extremo a extremo contra la pila real en sustituir.integration.test.ts
// (el cuerpo de sustituirParada) -- este test solo cubre la puerta de
// sesión del endpoint, igual que route.test.ts de GET /api/plan/[id].
describe.skipIf(!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY)("POST /api/plan/[id]/paradas/[paradaId]/sustituir (alt-ac6)", () => {
  it("sin sesión responde 401", async () => {
    const respuesta = await POST(peticion({ alternativa_id: "x" }), contexto("00000000-0000-0000-0000-000000000000", "parada-1"));
    expect(respuesta.status).toBe(401);
  });
});
