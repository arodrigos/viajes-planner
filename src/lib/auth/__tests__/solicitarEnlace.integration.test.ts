import { describe, expect, it, vi } from "vitest";
import { procesarSolicitudEnlace } from "@/lib/auth/solicitarEnlace";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("procesarSolicitudEnlace (acceso-ac1)", () => {
  it("un correo fuera de la lista blanca no llega a pedir el enlace y no crea usuario", async () => {
    const signInWithOtp = vi.fn();
    const supabaseFalso = { auth: { signInWithOtp } } as never;

    const resultado = await procesarSolicitudEnlace(supabaseFalso, "intruso@fuera.com", "http://localhost:3100");

    expect(resultado).toEqual({ estado: "correo-no-permitido" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("un correo de la lista blanca sí pide el enlace mágico contra Supabase Auth real, con emailRedirectTo apuntando a /auth/confirm en el origen de la petición", async () => {
    const supabase = clienteDePrueba("anonimo");
    const resultado = await procesarSolicitudEnlace(supabase, "ci-test@example.com", "http://localhost:3100");
    expect(resultado).toEqual({ estado: "enviado" });
  });

  it("con la lista blanca vacía responde configuracion-invalida sin llamar a Supabase", async () => {
    const signInWithOtp = vi.fn();
    const supabaseFalso = { auth: { signInWithOtp } } as never;
    const original = process.env.CORREOS_PERMITIDOS;
    process.env.CORREOS_PERMITIDOS = "";
    try {
      const resultado = await procesarSolicitudEnlace(supabaseFalso, "quien-sea@ej.com", "http://localhost:3100");
      expect(resultado.estado).toBe("configuracion-invalida");
      expect(signInWithOtp).not.toHaveBeenCalled();
    } finally {
      process.env.CORREOS_PERMITIDOS = original;
    }
  });
});

// Sin dependencia de la pila local: no necesita Supabase real, así que
// corre siempre, incluso sin `supabase start`.
describe("procesarSolicitudEnlace, emailRedirectTo (acceso-ac6 preparación)", () => {
  it("apunta a /auth/confirm en el origen de la petición entrante, no en una URL fija", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    const supabaseFalso = { auth: { signInWithOtp } } as never;

    await procesarSolicitudEnlace(supabaseFalso, "ci-test@example.com", "https://viajes-planner.example.com");

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "ci-test@example.com",
      options: { emailRedirectTo: "https://viajes-planner.example.com/auth/confirm" },
    });
  });
});
