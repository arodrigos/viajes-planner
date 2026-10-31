import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

// es-4: el cliente de Auth es un doble; nada de esto llega a Supabase real.
const signInWithOtp = vi.fn();
vi.mock("@/lib/db/cliente", () => ({ clienteAnonimo: () => ({ auth: { signInWithOtp } }) }));

import { MENSAJE_CODIGO_SOLICITADO, POST } from "./manejador";

const CORREO = "familia@example.com";

function peticion(cuerpo: Record<string, unknown>) {
  return new Request("http://localhost/api/acceso/solicitar-codigo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

async function respuesta(email: string) {
  const r = await POST(peticion({ email }));
  return { status: r.status, cuerpo: await r.json() };
}

let aviso: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("CORREOS_PERMITIDOS", CORREO);
  signInWithOtp.mockReset();
  aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  aviso.mockRestore();
});

const ESPERADO = { status: 200, cuerpo: { ok: true, mensaje: MENSAJE_CODIGO_SOLICITADO } };

describe("POST /api/acceso/solicitar-codigo (es-2, es-5)", () => {
  it("envío correcto: 200 con el mensaje fijo y sin log", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    expect(await respuesta(CORREO)).toEqual(ESPERADO);
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    expect(aviso).not.toHaveBeenCalled();
  });

  it("correo no autorizado: misma respuesta y 0 llamadas", async () => {
    expect(await respuesta("intruso@fuera.com")).toEqual(ESPERADO);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it.each([
    ["límite", { status: 429, code: "over_email_send_rate_limit", message: "you can only request this after 59 seconds" }, "limite-envios", 429],
    ["límite con code desconocido", { status: 429, code: "limite_nuevo_x", message: "slow down" }, "limite-envios", 429],
    ["límite sin code", { status: 429, code: undefined, message: "slow down" }, "limite-envios", 429],
    ["correo inválido", { status: 400, code: "email_address_invalid", message: "Email address is invalid" }, "correo-invalido", 400],
    ["no clasificado", { status: 500, code: "raro", message: "boom" }, "fallo-envio", 502],
  ])("%s: 200 idéntico y el detalle solo en el log", async (_n, error, tipo, http) => {
    signInWithOtp.mockResolvedValue({ error });
    expect(await respuesta(CORREO)).toEqual(ESPERADO);
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso.mock.calls[0][0]).toMatchObject({
      evento: "solicitar-codigo-rechazado",
      tipo,
      http_equivalente: http,
      status: error.status,
      code: error.code,
    });
    const log = JSON.stringify(aviso.mock.calls);
    expect(log).not.toContain(error.message);
    expect(log).not.toContain(CORREO);
  });

  it("sin email sigue dando 400", async () => {
    const r = await POST(peticion({}));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "falta email" });
  });

  it("lista blanca vacía sigue en 500", async () => {
    vi.stubEnv("CORREOS_PERMITIDOS", "");
    expect((await POST(peticion({ email: CORREO }))).status).toBe(500);
  });

  it("invariante: para cualquier error de Auth, respuesta igual a la del envío y sin message ni correo en cuerpo o log", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          status: fc.option(fc.integer({ min: 100, max: 599 }), { nil: undefined }),
          code: fc.option(fc.string(), { nil: undefined }),
          message: fc.string({ minLength: 8 }).map((m) => `MSG-${m}`),
        }),
        async (error) => {
          aviso.mockClear();
          signInWithOtp.mockResolvedValue({ error });
          const r = await respuesta(CORREO);
          expect(r).toEqual(ESPERADO);
          expect(JSON.stringify(r)).not.toContain(error.message);
          const log = JSON.stringify(aviso.mock.calls);
          expect(log).not.toContain(error.message);
          expect(log).not.toContain(CORREO);
        },
      ),
    );
  });
});
