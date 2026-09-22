import { createServerClient } from "@supabase/ssr";
import { describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

// viajes-ac3: la RLS de la migración 7 como SEGUNDA capa. La primera y real
// es el filtro por usuario_id de listarViajes (src/lib/cola/listar.ts), que
// usa la clave de SERVICIO y por tanto atraviesa esta misma RLS sin pasar
// por ella -- este test no sustituye a mis-viajes.movil.e2e.ts (viajes-ac1),
// que es el único que atrapa un filtro de aplicación olvidado. Lo que
// comprueba aquí es la red para un camino futuro que lea `trabajos` con la
// clave anónima y un JWT de usuario, camino que hoy no existe en el producto.
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ESQUEMA = "viajes_planner";

// Mismo patrón que cookieDeSesion en requireSesion.integration.test.ts, pero
// devolviendo el access_token en vez de la cabecera Cookie: aquí se habla
// directo con PostgREST, no con una NextRequest.
async function tokenDeSesion(email: string): Promise<string> {
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
  const { data, error } = await cliente.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (error || !data.session) throw new Error(`No se pudo confirmar el enlace de prueba: ${error?.message}`);
  return data.session.access_token;
}

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("RLS sobre trabajos con JWT de usuario (viajes-ac3)", () => {
  it("un usuario autenticado lee por PostgREST directo solo sus propios trabajos, y sin sesión sigue viendo cero filas", async () => {
    const servicio = clienteDePrueba("servicio");
    const marca = Date.now();
    const { data: usuarioA, error: errorA } = await servicio.auth.admin.createUser({
      email: `viajes-ac3-a-${marca}@ej.com`,
      email_confirm: true,
    });
    if (errorA || !usuarioA.user) throw new Error(`No se pudo crear el usuario A: ${errorA?.message}`);
    const { data: usuarioB, error: errorB } = await servicio.auth.admin.createUser({
      email: `viajes-ac3-b-${marca}@ej.com`,
      email_confirm: true,
    });
    if (errorB || !usuarioB.user) throw new Error(`No se pudo crear el usuario B: ${errorB?.message}`);

    const { error: errorTrabajoA } = await servicio
      .from("trabajos")
      .insert({ usuario_id: usuarioA.user.id, tipo: "generacion", criterios: {}, estado: "completado" });
    if (errorTrabajoA) throw new Error(`No se pudo sembrar el trabajo de A: ${errorTrabajoA.message}`);
    const { error: errorTrabajoB } = await servicio
      .from("trabajos")
      .insert({ usuario_id: usuarioB.user.id, tipo: "generacion", criterios: {}, estado: "completado" });
    if (errorTrabajoB) throw new Error(`No se pudo sembrar el trabajo de B: ${errorTrabajoB.message}`);

    const tokenA = await tokenDeSesion(`viajes-ac3-a-${marca}@ej.com`);

    const respuestaA = await fetch(`${SUPABASE_URL}/rest/v1/trabajos?select=id,usuario_id`, {
      headers: { apikey: ANON_KEY as string, Authorization: `Bearer ${tokenA}`, "Accept-Profile": ESQUEMA },
    });
    expect(respuestaA.status).toBe(200);
    const filasA = (await respuestaA.json()) as { usuario_id: string }[];
    expect(filasA.length).toBeGreaterThan(0);
    expect(filasA.every((fila) => fila.usuario_id === usuarioA.user!.id)).toBe(true);

    const respuestaSinSesion = await fetch(`${SUPABASE_URL}/rest/v1/trabajos?select=id`, {
      headers: { apikey: ANON_KEY as string, Authorization: `Bearer ${ANON_KEY}`, "Accept-Profile": ESQUEMA },
    });
    expect(respuestaSinSesion.status).toBe(200);
    expect(await respuestaSinSesion.json()).toEqual([]);
  });
});
