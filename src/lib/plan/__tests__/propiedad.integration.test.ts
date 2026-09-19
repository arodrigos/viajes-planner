import { beforeAll, describe, expect, it } from "vitest";
import { planPerteneceAUsuario } from "@/lib/plan/propiedad";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("planPerteneceAUsuario (vista-ac2, exposición de planes)", () => {
  const supabase = clienteDePrueba();
  let usuarioId = "";
  const planId = `plan-propiedad-${Date.now()}`;

  beforeAll(async () => {
    const correo = `propiedad-plan-${Date.now()}@ej.com`;
    const { data, error } = await supabase.auth.admin.createUser({ email: correo, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
    usuarioId = data.user.id;

    const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Oporto" });
    if (errorPlan) throw new Error(`No se pudo crear el plan de prueba: ${errorPlan.message}`);

    const { error: errorTrabajo } = await supabase
      .from("trabajos")
      .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
    if (errorTrabajo) throw new Error(`No se pudo crear el trabajo de prueba: ${errorTrabajo.message}`);
  });

  it("es propio cuando existe un trabajo de ese usuario que apunta a ese plan", async () => {
    await expect(planPerteneceAUsuario(supabase, planId, usuarioId)).resolves.toBe(true);
  });

  it("no es propio de otro usuario", async () => {
    await expect(planPerteneceAUsuario(supabase, planId, "00000000-0000-0000-0000-000000000000")).resolves.toBe(
      false,
    );
  });

  it("no es propio de un plan que no existe", async () => {
    await expect(planPerteneceAUsuario(supabase, "plan-que-no-existe", usuarioId)).resolves.toBe(false);
  });
});
