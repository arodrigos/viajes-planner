import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { POST as postVerificarCodigo } from "@/app/api/acceso/verificar-codigo/route";
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

// Obtiene el email_otp REAL emitido por Supabase para `email` sin pasar por
// el correo -- la entrega real ya la cubre el bloque siguiente, que es
// donde existe la plantilla de código. `generateLink` con `magiclink` crea
// el usuario si no existía, igual que hace `cookieDeSesion` en
// requireSesion.integration.test.ts para el token_hash del enlace.
async function emailOtpReal(email: string): Promise<string> {
  const servicio = clienteDePrueba("servicio");
  const generado = await servicio.auth.admin.generateLink({ type: "magiclink", email });
  if (generado.error) throw new Error(`No se pudo generar el código de prueba: ${generado.error.message}`);
  const codigo = generado.data.properties?.email_otp;
  if (!codigo) throw new Error("generateLink no devolvió email_otp");
  return codigo;
}

function peticionVerificarCodigo(cuerpo: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/acceso/verificar-codigo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

// La cabecera Cookie que un navegador mandaría en la siguiente petición, a
// partir de los Set-Cookie reales de la respuesta -- no se asume el nombre
// de las cookies de Supabase, se reenvían tal cual.
function cabeceraCookie(respuesta: Response): string {
  return respuesta.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("POST /api/acceso/verificar-codigo", () => {
  it("cod-ac1: un código válido de un correo autorizado crea una sesión que sirve para encolar", async () => {
    const email = "ci-test-cod-ac1@example.com";
    const codigo = await emailOtpReal(email);

    const respuesta = await postVerificarCodigo(peticionVerificarCodigo({ email, codigo }));
    expect(respuesta.status).toBe(200);
    const cookie = cabeceraCookie(respuesta);
    expect(cookie).toMatch(/sb-/);

    const respuestaPlan = await postPlan(
      new NextRequest("http://localhost/api/plan", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(CRITERIOS_VALIDOS),
      }),
    );
    expect(respuestaPlan.status).toBe(202);
    const { id } = (await respuestaPlan.json()) as { id: string };

    const servicio = clienteDePrueba("servicio");
    const { data: trabajo } = await servicio.from("trabajos").select("estado, criterios").eq("id", id).single();
    expect(trabajo?.estado).toBe("encolado");
    expect(trabajo?.criterios).toEqual(CRITERIOS_VALIDOS);

    const respuestaTrabajo = await getTrabajo(
      new NextRequest(`http://localhost/api/trabajos/${id}`, { headers: { cookie } }),
      { params: Promise.resolve({ id }) },
    );
    expect(respuestaTrabajo.status).toBe(200);
  });

  it("cod-ac2(a,b): ningún código que no sea el bueno crea sesión, tampoco el ya usado, sin esperar a que expire nada", async () => {
    const email = "ci-test-cod-ac2@example.com";
    const codigoReal = await emailOtpReal(email);
    const codigoIncorrecto = codigoReal === "000000" ? "111111" : "000000";

    const respuestaIncorrecta = await postVerificarCodigo(peticionVerificarCodigo({ email, codigo: codigoIncorrecto }));
    expect(respuestaIncorrecta.status).toBe(401);
    expect(respuestaIncorrecta.headers.getSetCookie()).toHaveLength(0);

    const respuestaPlanConLoDevuelto = await postPlan(
      new NextRequest("http://localhost/api/plan", {
        method: "POST",
        headers: { cookie: cabeceraCookie(respuestaIncorrecta), "content-type": "application/json" },
        body: JSON.stringify(CRITERIOS_VALIDOS),
      }),
    );
    expect(respuestaPlanConLoDevuelto.status).toBe(401);

    // Consumido por agotamiento del token de un solo uso, no por espera de reloj.
    const respuestaExito = await postVerificarCodigo(peticionVerificarCodigo({ email, codigo: codigoReal }));
    expect(respuestaExito.status).toBe(200);

    const respuestaReintento = await postVerificarCodigo(peticionVerificarCodigo({ email, codigo: codigoReal }));
    expect(respuestaReintento.status).toBe(401);
    expect(respuestaReintento.headers.getSetCookie()).toHaveLength(0);
  });

  it("cod-ac2(c): una petición mal formada no llega a llamar a Supabase Auth", async () => {
    const email = "ci-test-cod-ac2@example.com";
    const casos: Record<string, unknown>[] = [
      {},
      { email },
      { email, codigo: "12345" },
      { email, codigo: "abcdef" },
    ];

    for (const cuerpo of casos) {
      const respuesta = await postVerificarCodigo(peticionVerificarCodigo(cuerpo));
      expect(respuesta.status).toBe(400);
      expect(respuesta.headers.getSetCookie()).toHaveLength(0);
    }
  });

  it("cod-ac3: un correo fuera de la lista blanca no puede canjear su código aunque sea real y vigente", async () => {
    const emailAjeno = `foraneo-cod-${Date.now()}@ej.com`;
    const servicio = clienteDePrueba("servicio");
    const { error: errorCrear } = await servicio.auth.admin.createUser({ email: emailAjeno, email_confirm: true });
    if (errorCrear) throw new Error(`No se pudo crear el usuario ajeno de prueba: ${errorCrear.message}`);
    const codigoAjeno = await emailOtpReal(emailAjeno);

    const respuesta = await postVerificarCodigo(peticionVerificarCodigo({ email: emailAjeno, codigo: codigoAjeno }));
    expect(respuesta.status).toBe(403);
    expect(respuesta.headers.getSetCookie()).toHaveLength(0);

    // El código sigue vigente: si nuestro endpoint lo hubiera consumido, este
    // canje directo contra Supabase Auth fallaría. Es lo que hace el
    // criterio no circular -- si alguien invierte el orden de las dos líneas
    // en procesarVerificacionCodigo, este canje directo se pondría rojo
    // porque el código ya estaría consumido.
    const clienteDirecto = createServerClient(SUPABASE_URL!, ANON_KEY!, {
      cookies: { getAll: () => [], setAll: () => {} },
    });
    const { error: errorCanjeDirecto } = await clienteDirecto.auth.verifyOtp({
      email: emailAjeno,
      token: codigoAjeno,
      type: "email",
    });
    expect(errorCanjeDirecto).toBeNull();

    // Con un correo SÍ autorizado el camino legítimo sigue funcionando: la
    // comprobación de más arriba no se ha puesto de más.
    const emailAutorizado = "ci-test-cod-ac3@example.com";
    const codigoAutorizado = await emailOtpReal(emailAutorizado);
    const respuestaAutorizada = await postVerificarCodigo(
      peticionVerificarCodigo({ email: emailAutorizado, codigo: codigoAutorizado }),
    );
    expect(respuestaAutorizada.status).toBe(200);
  });
});
