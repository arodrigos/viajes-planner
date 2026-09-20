import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/plan/route";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CRITERIOS_VALIDOS = {
  destino_o_tipo: "Oporto",
  fechas: { modo: "epoca", epoca: "otoño" },
  dias: 3,
  personas: [{ edad: 40 }],
  perfil: "solo",
  presupuesto_eur: 600,
};

// acceso-ac1 en la capa HTTP real: sin sesión, 401, y nada se encola. El
// resto del contrato de este endpoint (criterios inválidos -> 400, límite
// superado -> 429, válido -> 202 con id) lo cubre crear.integration.test.ts
// contra la misma base de datos real y contra la misma función que este
// route.ts envuelve: la ruta en sí es un mapeo directo de ese resultado a
// un código HTTP, sin lógica propia que justifique repetir cada caso aquí
// con una sesión fabricada.
describe.skipIf(!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY)("POST /api/plan (acceso-ac1)", () => {
  it("sin sesión responde 401 y no crea ningún trabajo", async () => {
    const supabase = clienteDePrueba();
    const { count: antes } = await supabase.from("trabajos").select("id", { count: "exact", head: true });

    const respuesta = await POST(
      new NextRequest("http://localhost/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(CRITERIOS_VALIDOS),
      }),
    );
    expect(respuesta.status).toBe(401);

    const { count: despues } = await supabase.from("trabajos").select("id", { count: "exact", head: true });
    expect(despues).toBe(antes);
  });
});
