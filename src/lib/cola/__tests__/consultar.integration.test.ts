import { beforeAll, describe, expect, it } from "vitest";
import { obtenerTrabajo } from "@/lib/cola/consultar";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("obtenerTrabajo (acceso-ac3, exposición de planes)", () => {
  const supabase = clienteDePrueba();
  let usuarioId = "";

  beforeAll(async () => {
    const correo = `consultar-trabajo-${Date.now()}@ej.com`;
    const { data, error } = await supabase.auth.admin.createUser({ email: correo, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
    usuarioId = data.user.id;
  });

  it("un trabajo recién encolado es consultable desde el instante de creación", async () => {
    const { data: trabajo, error } = await supabase
      .from("trabajos")
      .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: {} })
      .select("id")
      .single();
    if (error || !trabajo) throw new Error(`No se pudo crear el trabajo de prueba: ${error?.message}`);

    const resultado = await obtenerTrabajo(supabase, trabajo.id, usuarioId);
    expect(resultado?.estado).toBe("encolado");
    expect(resultado?.porcentaje).toBe(0);
  });

  it("un trabajo con etapa en curso trae su porcentaje y nombre de etapa", async () => {
    const { data: trabajo, error } = await supabase
      .from("trabajos")
      .insert({
        usuario_id: usuarioId,
        tipo: "generacion",
        criterios: {},
        estado: "en-curso",
        etapa: "verificando sitios",
      })
      .select("id")
      .single();
    if (error || !trabajo) throw new Error(`No se pudo crear el trabajo de prueba: ${error?.message}`);

    const resultado = await obtenerTrabajo(supabase, trabajo.id, usuarioId);
    expect(resultado?.etapa).toBe("verificando sitios");
    expect(resultado?.porcentaje).toBeGreaterThan(0);
  });

  it("un trabajo encolado hace tiempo caduca con motivo al leerlo (acceso-ac3)", async () => {
    const haceMucho = new Date(Date.now() - 100 * 3_600_000).toISOString();
    const { data: trabajo, error } = await supabase
      .from("trabajos")
      .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: {}, creado_en: haceMucho })
      .select("id")
      .single();
    if (error || !trabajo) throw new Error(`No se pudo crear el trabajo de prueba: ${error?.message}`);

    const resultado = await obtenerTrabajo(supabase, trabajo.id, usuarioId);
    expect(resultado?.estado).toBe("caducado");
    expect(resultado?.motivo).toMatch(/no ha recogido/);

    const { data: fila } = await supabase.from("trabajos").select("estado").eq("id", trabajo.id).single();
    expect(fila?.estado).toBe("caducado");
  });

  it("el trabajo de otro usuario no es visible: devuelve null, no un error", async () => {
    const { data: trabajo, error } = await supabase
      .from("trabajos")
      .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: {} })
      .select("id")
      .single();
    if (error || !trabajo) throw new Error(`No se pudo crear el trabajo de prueba: ${error?.message}`);

    const resultado = await obtenerTrabajo(supabase, trabajo.id, "00000000-0000-0000-0000-000000000000");
    expect(resultado).toBeNull();
  });

  // final-ac1: dos capas porque el tipo puede estar bien y el `select` mal
  // -este fichero prueba la capa de datos; la capa HTTP se cubre en
  // route.integration.test.ts (acceso-ac1) y en final-ac2 (e2e, JSON real).
  describe("plan_id (final-ac1)", () => {
    it("un trabajo completado que apunta a un plan devuelve ese plan_id exacto", async () => {
      const planId = `plan-final-ac1-${Date.now()}`;
      const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Lisboa" });
      if (errorPlan) throw new Error(`No se pudo crear el plan de prueba: ${errorPlan.message}`);

      const { data: trabajo, error } = await supabase
        .from("trabajos")
        .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId })
        .select("id")
        .single();
      if (error || !trabajo) throw new Error(`No se pudo crear el trabajo de prueba: ${error?.message}`);

      const resultado = await obtenerTrabajo(supabase, trabajo.id, usuarioId);
      expect(resultado?.plan_id).toBe(planId);
    });

    // Caso hermano: sin él, un `select("plan_id, '<constante>' as plan_id")`
    // fabricado a mano también pasaría el caso anterior.
    it("un trabajo encolado (sin plan todavía) devuelve plan_id: null", async () => {
      const { data: trabajo, error } = await supabase
        .from("trabajos")
        .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: {} })
        .select("id")
        .single();
      if (error || !trabajo) throw new Error(`No se pudo crear el trabajo de prueba: ${error?.message}`);

      const resultado = await obtenerTrabajo(supabase, trabajo.id, usuarioId);
      expect(resultado?.plan_id).toBeNull();
    });

    it("un trabajo completado de OTRO usuario sigue sin ser visible: no filtra su plan_id", async () => {
      const planId = `plan-final-ac1-ajeno-${Date.now()}`;
      const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Oporto" });
      if (errorPlan) throw new Error(`No se pudo crear el plan de prueba: ${errorPlan.message}`);

      const { data: trabajo, error } = await supabase
        .from("trabajos")
        .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId })
        .select("id")
        .single();
      if (error || !trabajo) throw new Error(`No se pudo crear el trabajo de prueba: ${error?.message}`);

      const resultado = await obtenerTrabajo(supabase, trabajo.id, "00000000-0000-0000-0000-000000000000");
      expect(resultado).toBeNull();
    });
  });
});
