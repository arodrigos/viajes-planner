import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { procesarSolicitudEnlace } from "@/lib/auth/solicitarEnlace";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("procesarSolicitudEnlace (acceso-ac1)", () => {
  it("un correo fuera de la lista blanca no llega a pedir el enlace y no crea usuario", async () => {
    const signInWithOtp = vi.fn();
    const supabaseFalso = { auth: { signInWithOtp } } as never;

    const resultado = await procesarSolicitudEnlace(supabaseFalso, "intruso@fuera.com");

    expect(resultado).toEqual({ estado: "correo-no-permitido" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("un correo de la lista blanca sí pide el enlace mágico contra Supabase Auth real", async () => {
    const supabase = createClient(SUPABASE_URL ?? "", ANON_KEY ?? "");
    const resultado = await procesarSolicitudEnlace(supabase, "ci-test@example.com");
    expect(resultado).toEqual({ estado: "enviado" });
  });

  it("con la lista blanca vacía responde configuracion-invalida sin llamar a Supabase", async () => {
    const signInWithOtp = vi.fn();
    const supabaseFalso = { auth: { signInWithOtp } } as never;
    const original = process.env.CORREOS_PERMITIDOS;
    process.env.CORREOS_PERMITIDOS = "";
    try {
      const resultado = await procesarSolicitudEnlace(supabaseFalso, "quien-sea@ej.com");
      expect(resultado.estado).toBe("configuracion-invalida");
      expect(signInWithOtp).not.toHaveBeenCalled();
    } finally {
      process.env.CORREOS_PERMITIDOS = original;
    }
  });
});
