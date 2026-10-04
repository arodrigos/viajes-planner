import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "../route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function contexto(id: string) {
  return { params: Promise.resolve({ id }) };
}

function peticion(id: string) {
  return new NextRequest(`http://localhost/api/plan/${id}/calendario.ics`);
}

// ics-ac1: la autorización real (404 de plan ajeno) y la descarga completa
// se prueban contra la pila real en route.integration.test.ts -- este test
// solo cubre la puerta de sesión, mismo patrón que visitas/__tests__/route.test.ts.
describe.skipIf(!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY)("GET /api/plan/[id]/calendario.ics (ics-ac1)", () => {
  it("sin sesión responde 401", async () => {
    const respuesta = await GET(peticion("00000000-0000-0000-0000-000000000000"), contexto("00000000-0000-0000-0000-000000000000"));
    expect(respuesta.status).toBe(401);
  });
});
