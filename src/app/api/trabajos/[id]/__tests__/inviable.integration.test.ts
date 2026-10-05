import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/trabajos/[id]/route";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORREO_DUENO = "ci-test-inviable-dueno@example.com";
const CORREO_OTRO = "ci-test-inviable-otro@example.com";

const INVIABLE = {
  razones: [{ codigo: "distancia", texto: "Portugal y Grecia están como mínimo a 2.289 km, y con lo que has marcado (tren, autobús) no se llega en 4 h." }],
  sugerencias: ["Marca «Avión» o elige países más cercanos."],
};

function contexto(id: string) {
  return { params: Promise.resolve({ id }) };
}

// Misma emisión de sesión real que requireSesion.integration.test.ts: el
// códec de cookies de @supabase/ssr, sin pasar por el correo.
async function usuarioConSesion(correo: string): Promise<{ id: string; cookie: string }> {
  const servicio = clienteDePrueba("servicio");
  const existente = await servicio.auth.admin.createUser({ email: correo, email_confirm: true });
  let id = existente.data.user?.id;
  if (!id) {
    const { data } = await servicio.auth.admin.listUsers({ perPage: 1000 });
    id = data.users.find((u) => u.email === correo)?.id;
  }
  if (!id) throw new Error(`No se pudo obtener el usuario ${correo}`);

  const generado = await servicio.auth.admin.generateLink({ type: "magiclink", email: correo });
  const tokenHash = generado.data.properties?.hashed_token;
  if (generado.error || !tokenHash) throw new Error(`No se pudo generar el enlace de prueba: ${generado.error?.message}`);
  const jar = new Map<string, string>();
  const cliente = createServerClient(SUPABASE_URL!, ANON_KEY!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await cliente.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (error) throw new Error(`No se pudo confirmar el enlace de prueba: ${error.message}`);
  return { id, cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") };
}

function peticion(id: string, cookie: string) {
  return new NextRequest(`http://localhost/api/trabajos/${id}`, { headers: { cookie } });
}

// dmc-ac5: la explicación de un trabajo descartado solo la ve su dueño.
describe.skipIf(!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY)("GET /api/trabajos/[id] con un trabajo inviable (dmc-ac5)", () => {
  let dueno: { id: string; cookie: string };
  let otro: { id: string; cookie: string };
  let trabajoId = "";

  beforeAll(async () => {
    dueno = await usuarioConSesion(CORREO_DUENO);
    otro = await usuarioConSesion(CORREO_OTRO);
    const { data, error } = await clienteDePrueba("servicio")
      .from("trabajos")
      .insert({
        usuario_id: dueno.id,
        tipo: "generacion",
        criterios: { destino_o_tipo: "Portugal y Grecia", dias: 10 },
        estado: "fallido",
        motivo: "inviable",
        inviable: INVIABLE,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo sembrar el trabajo: ${error?.message}`);
    trabajoId = data.id;
  });

  it("el dueño recibe las razones, las sugerencias y sus criterios", async () => {
    const respuesta = await GET(peticion(trabajoId, dueno.cookie), contexto(trabajoId));
    expect(respuesta.status).toBe(200);
    const cuerpo = await respuesta.json();
    expect(cuerpo.estado).toBe("fallido");
    expect(cuerpo.inviable).toEqual(INVIABLE);
    expect(cuerpo.criterios_inviable.destino_o_tipo).toBe("Portugal y Grecia");
  });

  it("otro usuario recibe un 404 idéntico byte a byte al de un trabajo inexistente", async () => {
    const ajeno = await GET(peticion(trabajoId, otro.cookie), contexto(trabajoId));
    const inexistenteId = "00000000-0000-0000-0000-000000000000";
    const inexistente = await GET(peticion(inexistenteId, otro.cookie), contexto(inexistenteId));
    expect(ajeno.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(await ajeno.text()).toBe(await inexistente.text());
    expect(Object.fromEntries(ajeno.headers)).toEqual(Object.fromEntries(inexistente.headers));
  });
});
