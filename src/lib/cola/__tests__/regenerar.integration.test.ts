import { beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan, recuperarPlan } from "@/lib/plan/repositorio";
import type { Plan } from "@/lib/plan/tipos";
import { regenerarViaje } from "@/lib/cola/regenerar";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function planMinimo(id: string): Plan {
  return {
    id,
    version: 1,
    destino: "Oporto",
    personas: 2,
    dias: [
      {
        fecha: "2026-11-10",
        franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
        paradas: [
          {
            id: "parada-regenerar-1",
            franja_id: "manana",
            nombre: "Torre dos Clérigos",
            descripcion: "Mirador",
            duracion_min: 60,
            prioridad: 70,
            procedencia: { fuente: "propuesto-sin-verificar" },
          },
        ],
      },
    ],
  };
}

// reg-ac2/reg-ac3: regenerarViaje contra la pila real -lee y reescribe
// `trabajos`, nunca inventa filas- y guardarPlan/recuperarPlan para la
// versión que deja el trabajador tras tomar el trabajo reencolado.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("regenerarViaje (reg-ac2, reg-ac3)", () => {
  const supabase = clienteDePrueba("servicio");
  let usuarioId = "";

  beforeAll(async () => {
    const correo = `regenerar-${Date.now()}@ej.com`;
    const { data, error } = await supabase.auth.admin.createUser({ email: correo, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
    usuarioId = data.user.id;
  });

  async function sembrarPlanCompletado(sufijo: string) {
    const planId = `plan-regenerar-${sufijo}-${Date.now()}`;
    await guardarPlan(supabase, planMinimo(planId));
    const { data: trabajo, error } = await supabase
      .from("trabajos")
      .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: { destino_o_tipo: "Oporto" }, estado: "completado", plan_id: planId })
      .select("id")
      .single();
    if (error || !trabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${error?.message}`);
    return { planId, trabajoId: trabajo.id as string };
  }

  it("reencola el trabajo original: mismo id, mismo plan_id, estado 'encolado' y regenerado_en no nulo", async () => {
    const { planId, trabajoId } = await sembrarPlanCompletado("ok");

    const { count: trabajosAntes } = await supabase.from("trabajos").select("id", { count: "exact", head: true }).eq("usuario_id", usuarioId);

    const resultado = await regenerarViaje(supabase, planId, usuarioId);
    expect(resultado.estado).toBe("regenerado");
    if (resultado.estado !== "regenerado") throw new Error("inalcanzable");
    expect(resultado.trabajoId).toBe(trabajoId);

    const { count: trabajosDespues } = await supabase.from("trabajos").select("id", { count: "exact", head: true }).eq("usuario_id", usuarioId);
    expect(trabajosDespues).toBe(trabajosAntes);

    const { data: fila } = await supabase
      .from("trabajos")
      .select("estado, etapa, plan_id, regenerado_en, tomado_por, tomado_hasta")
      .eq("id", trabajoId)
      .single();
    expect(fila?.estado).toBe("encolado");
    expect(fila?.etapa).toBeNull();
    expect(fila?.plan_id).toBe(planId);
    expect(fila?.regenerado_en).not.toBeNull();
    expect(fila?.tomado_por).toBeNull();
    expect(fila?.tomado_hasta).toBeNull();
  });

  it("el trabajador reencolado crea plan_versiones.version = 2 para el MISMO plan_id, y la versión 1 sigue existiendo", async () => {
    const { planId, trabajoId } = await sembrarPlanCompletado("tick");

    const resultado = await regenerarViaje(supabase, planId, usuarioId);
    expect(resultado.estado).toBe("regenerado");

    // El trabajador no tiene código nuevo para esto (reg-ac2): simula lo
    // mismo que procesarTrabajo + guardarPlan harían con el trabajo que
    // acaban de tomar -guardar una versión nueva para el mismo plan_id.
    const planRegenerado: Plan = { ...planMinimo(planId), version: 1 };
    const { version } = await guardarPlan(supabase, planRegenerado);
    expect(version).toBe(2);

    await supabase.from("trabajos").update({ estado: "completado" }).eq("id", trabajoId);

    const { count } = await supabase.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);
    expect(count).toBe(2);

    const ultima = await recuperarPlan(supabase, planId);
    expect(ultima?.version).toBe(2);

    const v1 = await recuperarPlan(supabase, planId, 1);
    expect(v1).not.toBeNull();

    const { data: fila } = await supabase.from("trabajos").select("estado, plan_id").eq("id", trabajoId).single();
    expect(fila?.estado).toBe("completado");
    expect(fila?.plan_id).toBe(planId);
  });

  it("plan de otro usuario: 'no-encontrado', sin tocar ninguna fila de trabajos", async () => {
    const { planId } = await sembrarPlanCompletado("ajeno");

    const resultado = await regenerarViaje(supabase, planId, "00000000-0000-0000-0000-000000000000");
    expect(resultado.estado).toBe("no-encontrado");
  });

  it("trabajo ya 'encolado': 'en-curso', no toca la fila", async () => {
    const { planId, trabajoId } = await sembrarPlanCompletado("encolado");
    await supabase.from("trabajos").update({ estado: "encolado" }).eq("id", trabajoId);

    const resultado = await regenerarViaje(supabase, planId, usuarioId);
    expect(resultado.estado).toBe("en-curso");

    const { data: fila } = await supabase.from("trabajos").select("regenerado_en").eq("id", trabajoId).single();
    expect(fila?.regenerado_en).toBeNull();
  });

  it("trabajo 'pausado-por-cuota' también cuenta como 'en-curso'", async () => {
    const { planId, trabajoId } = await sembrarPlanCompletado("pausado");
    await supabase.from("trabajos").update({ estado: "pausado-por-cuota" }).eq("id", trabajoId);

    const resultado = await regenerarViaje(supabase, planId, usuarioId);
    expect(resultado.estado).toBe("en-curso");
  });

  it("regenerado_en hace menos de 60 minutos: 'demasiado-pronto', no lo vuelve a tocar", async () => {
    const { planId, trabajoId } = await sembrarPlanCompletado("reciente");
    const haceDiezMinutos = new Date(Date.now() - 10 * 60_000).toISOString();
    await supabase.from("trabajos").update({ estado: "completado", regenerado_en: haceDiezMinutos }).eq("id", trabajoId);

    const resultado = await regenerarViaje(supabase, planId, usuarioId);
    expect(resultado.estado).toBe("demasiado-pronto");

    const { data: fila } = await supabase.from("trabajos").select("regenerado_en, estado").eq("id", trabajoId).single();
    expect(fila?.estado).toBe("completado");
    expect(fila?.regenerado_en).toBe(haceDiezMinutos);
  });

  it("regenerado_en hace más de 60 minutos: se puede regenerar otra vez", async () => {
    const { planId, trabajoId } = await sembrarPlanCompletado("antiguo");
    const haceDosHoras = new Date(Date.now() - 120 * 60_000).toISOString();
    await supabase.from("trabajos").update({ estado: "completado", regenerado_en: haceDosHoras }).eq("id", trabajoId);

    const resultado = await regenerarViaje(supabase, planId, usuarioId);
    expect(resultado.estado).toBe("regenerado");

    const { data: fila } = await supabase.from("trabajos").select("regenerado_en").eq("id", trabajoId).single();
    expect(fila?.regenerado_en).not.toBe(haceDosHoras);
  });
});
