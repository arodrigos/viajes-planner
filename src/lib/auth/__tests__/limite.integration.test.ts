import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { dentroDelLimite } from "@/lib/auth/limite";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// acceso-ac1: superado el límite de trabajos por usuario, no se encola
// nada más. Se verifica la función que ese gate usa contra una base de
// datos real (no HTTP: /api/plan lo construye el bloque cola-trabajos,
// que depende de este; ese bloque reverifica el 429 en la capa HTTP
// reutilizando exactamente esta función).
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("dentroDelLimite (acceso-ac1)", () => {
  const supabase = createClient(SUPABASE_URL ?? "", SERVICE_KEY ?? "");
  let usuarioId = "";
  const LIMITE = 3;

  beforeAll(async () => {
    const correo = `limite-${Date.now()}@ej.com`;
    const { data, error } = await supabase.auth.admin.createUser({ email: correo, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
    usuarioId = data.user.id;
  });

  it("dentro del límite permite encolar, y al alcanzarlo deja de permitirlo", async () => {
    for (let i = 0; i < LIMITE; i++) {
      expect(await dentroDelLimite(supabase, usuarioId, LIMITE, 1)).toBe(true);
      const { error } = await supabase.from("trabajos").insert({ usuario_id: usuarioId, tipo: "generacion" });
      if (error) throw new Error(`No se pudo insertar el trabajo de prueba: ${error.message}`);
    }

    expect(await dentroDelLimite(supabase, usuarioId, LIMITE, 1)).toBe(false);

    const { count } = await supabase
      .from("trabajos")
      .select("id", { count: "exact", head: true })
      .eq("usuario_id", usuarioId);
    expect(count).toBe(LIMITE);
  });
});
