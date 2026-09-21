import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { procesarSolicitudCodigo } from "@/lib/auth/solicitarCodigo";
import { POST as postSolicitarCodigo } from "@/app/api/acceso/solicitar-codigo/route";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

function peticionSolicitarCodigo(cuerpo: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/acceso/solicitar-codigo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("procesarSolicitudCodigo (acceso-ac1)", () => {
  it("un correo fuera de la lista blanca no llega a pedir el código y no crea usuario", async () => {
    const signInWithOtp = vi.fn();
    const supabaseFalso = { auth: { signInWithOtp } } as never;

    const resultado = await procesarSolicitudCodigo(supabaseFalso, "intruso@fuera.com");

    expect(resultado).toEqual({ estado: "correo-no-permitido" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("un correo de la lista blanca sí pide el código contra Supabase Auth real", async () => {
    const supabase = clienteDePrueba("anonimo");
    const resultado = await procesarSolicitudCodigo(supabase, "ci-test@example.com");
    expect(resultado).toEqual({ estado: "enviado" });
  });

  it("con la lista blanca vacía responde configuracion-invalida sin llamar a Supabase", async () => {
    const signInWithOtp = vi.fn();
    const supabaseFalso = { auth: { signInWithOtp } } as never;
    const original = process.env.CORREOS_PERMITIDOS;
    process.env.CORREOS_PERMITIDOS = "";
    try {
      const resultado = await procesarSolicitudCodigo(supabaseFalso, "quien-sea@ej.com");
      expect(resultado.estado).toBe("configuracion-invalida");
      expect(signInWithOtp).not.toHaveBeenCalled();
    } finally {
      process.env.CORREOS_PERMITIDOS = original;
    }
  });
});

// pantalla-ac8(d): la Route Handler completa (no solo la función pura) tiene
// que responder EXACTAMENTE igual -mismo código de estado y mismo cuerpo
// JSON- para un correo autorizado y para uno que no lo está. Se compara la
// respuesta entera serializada, no solo el status, porque una diferencia de
// un solo campo del cuerpo ya sería la fuga que este criterio prohíbe.
describe.skipIf(!SUPABASE_URL || !ANON_KEY)("POST /api/acceso/solicitar-codigo (pantalla-ac8d)", () => {
  it("responde igual para un correo autorizado y para uno que no lo está", async () => {
    const emailAutorizado = "ci-test-pantalla-ac8d-autorizado@example.com";
    const emailNoAutorizado = `ci-test-pantalla-ac8d-no-autorizado-${Date.now()}@fuera.example`;

    const respuestaAutorizada = await postSolicitarCodigo(peticionSolicitarCodigo({ email: emailAutorizado }));
    const respuestaNoAutorizada = await postSolicitarCodigo(peticionSolicitarCodigo({ email: emailNoAutorizado }));

    expect(respuestaNoAutorizada.status).toBe(respuestaAutorizada.status);
    expect(await respuestaNoAutorizada.json()).toEqual(await respuestaAutorizada.json());
  });

  it("solo el correo autorizado deja rastro real: mensaje en Mailpit y usuario en auth.users", async () => {
    const emailAutorizado = "ci-test-pantalla-ac8d-rastro-autorizado@example.com";
    const emailNoAutorizado = `ci-test-pantalla-ac8d-rastro-no-autorizado-${Date.now()}@fuera.example`;

    await postSolicitarCodigo(peticionSolicitarCodigo({ email: emailAutorizado }));
    await postSolicitarCodigo(peticionSolicitarCodigo({ email: emailNoAutorizado }));

    const servicio = clienteDePrueba("servicio");
    // perPage alto a propósito: la pila de CI es efímera y por debajo de ese
    // recuento, así que una sola página basta y no hace falta paginar -sin
    // esto, un correo nuevo podría caer fuera de la primera página por
    // defecto (50) según cuántos tests hayan creado usuarios antes.
    const { data: paginaUsuarios, error } = await servicio.auth.admin.listUsers({ perPage: 10000 });
    if (error) throw new Error(`No se pudo listar usuarios: ${error.message}`);
    const correos = paginaUsuarios.users.map((u) => u.email);
    expect(correos).toContain(emailAutorizado);
    expect(correos).not.toContain(emailNoAutorizado);

    const respuestaMailpit = await fetch(`http://127.0.0.1:54324/api/v1/messages?limit=50`);
    const { messages } = (await respuestaMailpit.json()) as { messages: { To: { Address: string }[] }[] };
    const destinatarios = messages.flatMap((m) => m.To?.map((d) => d.Address) ?? []);
    expect(destinatarios).toContain(emailAutorizado);
    expect(destinatarios).not.toContain(emailNoAutorizado);
  });
});
