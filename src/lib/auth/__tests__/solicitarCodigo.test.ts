import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clasificarErrorAuth, procesarSolicitudCodigo } from "@/lib/auth/solicitarCodigo";

// es-4: ninguna prueba llama a signInWithOtp contra Supabase real; el cliente
// es siempre un doble, así no se consume el límite de envíos compartido.
const CORREO = "familia@example.com";

function clienteConError(error: unknown) {
  const signInWithOtp = vi.fn().mockResolvedValue({ error });
  return { cliente: { auth: { signInWithOtp } } as unknown as SupabaseClient, signInWithOtp };
}

beforeEach(() => {
  vi.stubEnv("CORREOS_PERMITIDOS", CORREO);
});
afterEach(() => vi.unstubAllEnvs());

describe("procesarSolicitudCodigo: errores de Auth (es-1)", () => {
  it("over_email_send_rate_limit -> limite-envios", async () => {
    const { cliente } = clienteConError({
      status: 429,
      code: "over_email_send_rate_limit",
      message: "you can only request this after 59 seconds",
    });
    expect(await procesarSolicitudCodigo(cliente, CORREO)).toEqual({
      estado: "rechazado-por-auth",
      tipo: "limite-envios",
      status: 429,
      code: "over_email_send_rate_limit",
    });
  });

  it("email_address_invalid -> correo-invalido", async () => {
    const { cliente } = clienteConError({ status: 400, code: "email_address_invalid", message: "Email address is invalid" });
    expect(await procesarSolicitudCodigo(cliente, CORREO)).toMatchObject({ tipo: "correo-invalido" });
  });

  it.each([
    ["sin code y 429", { status: 429 }, "limite-envios"],
    ["sin code y 400", { status: 400 }, "correo-invalido"],
    ["email_address_not_authorized", { status: 422, code: "email_address_not_authorized" }, "correo-invalido"],
    ["over_request_rate_limit", { status: 429, code: "over_request_rate_limit" }, "limite-envios"],
    ["code desconocido y 429", { status: 429, code: "limite_nuevo_x" }, "limite-envios"],
    ["code desconocido y 500", { status: 500, code: "unexpected_failure" }, "fallo-envio"],
  ])("%s", async (_n, error, tipo) => {
    const { cliente } = clienteConError(error);
    expect(await procesarSolicitudCodigo(cliente, CORREO)).toMatchObject({ estado: "rechazado-por-auth", tipo });
  });

  it("invariante: un code conocido conserva su tipo con cualquier status; uno desconocido con 429 es límite", () => {
    const conocidos: Record<string, string> = {
      over_email_send_rate_limit: "limite-envios",
      over_request_rate_limit: "limite-envios",
      email_address_invalid: "correo-invalido",
      email_address_not_authorized: "correo-invalido",
    };
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: undefined }), fc.constantFrom(400, 422, 429, 500), (code, status) => {
        const { tipo } = clasificarErrorAuth({ status, code });
        if (code !== undefined && Object.hasOwn(conocidos, code)) expect(tipo).toBe(conocidos[code]);
        else if (status === 429) expect(tipo).toBe("limite-envios");
      }),
    );
    for (const [code, tipo] of Object.entries(conocidos)) {
      for (const status of [400, 422, 429, 500]) expect(clasificarErrorAuth({ status, code }).tipo).toBe(tipo);
    }
  });

  it("una excepción del cliente -> fallo-envio, sin lanzar", async () => {
    const cliente = { auth: { signInWithOtp: vi.fn().mockRejectedValue(new Error("red caída")) } } as unknown as SupabaseClient;
    expect(await procesarSolicitudCodigo(cliente, CORREO)).toEqual({ estado: "rechazado-por-auth", tipo: "fallo-envio" });
  });

  it("invariante: para cualquier error de Auth nunca lanza y el tipo es uno de la lista", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          status: fc.option(fc.integer({ min: 100, max: 599 }), { nil: undefined }),
          code: fc.option(fc.string(), { nil: undefined }),
          message: fc.string(),
        }),
        async (error) => {
          const { cliente } = clienteConError(error);
          const r = await procesarSolicitudCodigo(cliente, CORREO);
          expect(r.estado).toBe("rechazado-por-auth");
          if (r.estado === "rechazado-por-auth") {
            expect(["limite-envios", "correo-invalido", "fallo-envio"]).toContain(r.tipo);
          }
        },
      ),
    );
  });

  it("el caso correcto sigue siendo enviado", async () => {
    const { cliente, signInWithOtp } = clienteConError(null);
    expect(await procesarSolicitudCodigo(cliente, CORREO)).toEqual({ estado: "enviado" });
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it("un correo no autorizado no llama a signInWithOtp", async () => {
    const { cliente, signInWithOtp } = clienteConError(null);
    expect(await procesarSolicitudCodigo(cliente, "intruso@fuera.com")).toEqual({ estado: "correo-no-permitido" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});
