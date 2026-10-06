import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { POST as postPlan } from "@/app/api/plan/route";
import { GET as getTrabajo } from "@/app/api/trabajos/[id]/route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

const CRITERIOS_VALIDOS = {
  destino_o_tipo: "Lisboa",
  fechas: { modo: "epoca", epoca: "primavera" },
  dias: 4,
  personas: [{ edad: 38 }, { edad: 36 }],
  perfil: "pareja",
  presupuesto_eur: 1200,
};

// Emite una sesión real de Supabase Auth para `email` sin pasar por el
// correo (no hace falta: lo que se prueba aquí es requireSesion, no la
// entrega del código, que ya cubren pantalla-ac5.e2e.ts y
// verificarCodigo.integration.test.ts) y la devuelve como cabecera `Cookie`
// lista para una NextRequest. Reutiliza el códec de cookies real de
// @supabase/ssr en vez de fabricar el formato a mano, para que la sesión sea
// indistinguible de una emitida por el canje de código real.
async function cookieDeSesion(email: string): Promise<string> {
  const servicio = clienteDePrueba("servicio");
  const generado = await servicio.auth.admin.generateLink({ type: "magiclink", email });
  if (generado.error) throw new Error(`No se pudo generar el enlace de prueba: ${generado.error.message}`);
  const tokenHash = generado.data.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink no devolvió hashed_token");

  const jar = new Map<string, string>();
  const cliente = createServerClient(SUPABASE_URL!, ANON_KEY!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await cliente.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (error) throw new Error(`No se pudo confirmar el enlace de prueba: ${error.message}`);

  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

// acceso-ac5(b,c): la lista blanca sigue siendo la frontera DESPUÉS de
// autenticarse. `auth.users` es compartida entre todos los productos del proyecto, así que una
// sesión válida por sí sola (el caso ya cubierto por sesion.integration.test.ts
// con 401) no basta como prueba -- hace falta una sesión real de un correo
// fuera de CORREOS_PERMITIDOS, contra las rutas reales, para que este
// criterio pueda fallar de la forma en que realmente se rompería: antes de
// este caso, ese mismo correo obtenía 202 y una fila en `trabajos`.
describe.skipIf(!SUPABASE_URL || !ANON_KEY)("requireSesion tras autenticarse (acceso-ac5)", () => {
  let cookieForanea: string;
  let usuarioForaneoId: string;

  beforeAll(async () => {
    const email = `foraneo-${Date.now()}@ej.com`;
    const servicio = clienteDePrueba("servicio");
    const { data, error } = await servicio.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario ajeno de prueba: ${error?.message}`);
    usuarioForaneoId = data.user.id;
    cookieForanea = await cookieDeSesion(email);
  });

  it("POST /api/plan con sesión válida de un correo fuera de la lista blanca devuelve 403 y no encola nada", async () => {
    const request = new NextRequest("http://localhost/api/plan", {
      method: "POST",
      headers: { cookie: cookieForanea, "content-type": "application/json" },
      body: JSON.stringify(CRITERIOS_VALIDOS),
    });
    const respuesta = await postPlan(request);
    expect(respuesta.status).toBe(403);

    const servicio = clienteDePrueba("servicio");
    const { count } = await servicio
      .from("trabajos")
      .select("id", { count: "exact", head: true })
      .eq("usuario_id", usuarioForaneoId);
    expect(count).toBe(0);
  });

  it("GET /api/trabajos/<id> con esa misma sesión ajena devuelve 403, sin llegar a mirar el dueño del trabajo", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const request = new NextRequest(`http://localhost/api/trabajos/${id}`, {
      headers: { cookie: cookieForanea },
    });
    const respuesta = await getTrabajo(request, { params: Promise.resolve({ id }) });
    expect(respuesta.status).toBe(403);
  });
});
