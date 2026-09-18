import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/plan/[id]/route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function contexto(id: string) {
  return { params: Promise.resolve({ id }) };
}

// La lógica de propiedad está en propiedad.integration.test.ts contra la
// misma base de datos real; esta ruta solo añade la puerta de sesión
// (acceso-ac1) sobre esa función y sobre recuperarPlan.
describe.skipIf(!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY)("GET /api/plan/[id] (acceso-ac1)", () => {
  it("sin sesión responde 401", async () => {
    const respuesta = await GET(
      new NextRequest("http://localhost/api/plan/00000000-0000-0000-0000-000000000000"),
      contexto("00000000-0000-0000-0000-000000000000"),
    );
    expect(respuesta.status).toBe(401);
  });
});
