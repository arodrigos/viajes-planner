import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { refrescarTiposCambio } from "@/lib/cambio/refrescar";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const XML_DIA_1 = `<Cube><Cube time='2026-09-17'><Cube currency='USD' rate='1.1730'/></Cube></Cube>`;

function fetchFalso(estado: number, cuerpo: string) {
  return vi.fn(async () => new Response(cuerpo, { status: estado }));
}

// latido-ac3: se ejecuta contra Postgres real (no un doble de la base de
// datos); solo el fetch al BCE, un tercero fuera de nuestro control, está
// sustituido por una respuesta fija.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("refrescarTiposCambio (latido-ac3)", () => {
  const supabase = createClient(SUPABASE_URL ?? "", SERVICE_KEY ?? "");

  it("una respuesta válida del BCE inserta filas con su fecha de referencia", async () => {
    const resultado = await refrescarTiposCambio(supabase, fetchFalso(200, XML_DIA_1) as unknown as typeof fetch);
    expect(resultado).toEqual({ ok: true, fecha_referencia: "2026-09-17" });

    const { data } = await supabase
      .from("tipos_cambio")
      .select("tasa_eur")
      .eq("moneda", "USD")
      .eq("fecha_referencia", "2026-09-17")
      .single();
    expect(data?.tasa_eur).toBe(1.173);
  });

  it("un 503 del BCE no borra el tipo anterior ni lanza", async () => {
    await refrescarTiposCambio(supabase, fetchFalso(200, XML_DIA_1) as unknown as typeof fetch);

    const resultado = await refrescarTiposCambio(supabase, fetchFalso(503, "") as unknown as typeof fetch);
    expect(resultado.ok).toBe(false);
    expect(resultado.error).toContain("503");

    const { data } = await supabase
      .from("tipos_cambio")
      .select("tasa_eur")
      .eq("moneda", "USD")
      .eq("fecha_referencia", "2026-09-17")
      .single();
    expect(data?.tasa_eur).toBe(1.173);
  });
});
