import { beforeAll, describe, expect, it } from "vitest";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { postProcesarPlan } from "@/lib/generacion/postProcesar";
import { aPlanPublico } from "@/lib/plan/publico";
import { guardarPlan, recuperarPlan } from "@/lib/plan/repositorio";
import { planFixture } from "@/lib/plan/__fixtures__/plan-5-dias-4-personas";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { ensamblarYValidar } from "@/lib/trabajador/procesarTrabajo";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CRITERIOS: CriteriosViaje = {
  destino_o_tipo: "Sevilla",
  fechas: { modo: "epoca", epoca: "otoño" },
  dias: 5,
  personas: [{ edad: 8 }, { edad: 38 }, { edad: 36 }, { edad: 9 }],
  perfil: "familiar",
  presupuesto_eur: 2000,
};

// enl-ac2: cierra el eslabón que ensamblarYValidar.reco-ac3 y VistaPlan.reco-ac3
// no cubren -qué queda ESCRITO en plan_versiones.recomendaciones y qué
// devuelven recuperarPlan + aPlanPublico- recorriendo el camino de
// producción COMPLETO (ensamblarYValidar -> postProcesarPlan -> guardarPlan
// -> recuperarPlan -> aPlanPublico) contra la pila real de Supabase.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("persistencia de recomendaciones (enl-ac2)", () => {
  const supabase = clienteDePrueba();
  const marca = Date.now();

  beforeAll(async () => {
    await supabase.from("planes").delete().in("id", [`plan-enl-ac2-url-${marca}`, `plan-enl-ac2-nombre-${marca}`]);
  });

  it("una recomendación con campo 'url' inventado: no sobrevive al guardado ni a la lectura, y no se tira", async () => {
    const planId = `plan-enl-ac2-url-${marca}`;
    const respuestaCruda = JSON.stringify({
      dias: planFixture.dias,
      recomendaciones: [
        {
          tipo: "comida",
          nombre: "Sitio Envenenado",
          motivo: "El modelo dice que merece la pena.",
          url: "https://malicioso.example/x",
        },
      ],
    });

    const intento = ensamblarYValidar(CRITERIOS, planId, respuestaCruda);
    expect(intento.valido).toBe(true);
    if (!intento.valido) return;
    const { plan: planFinal } = postProcesarPlan(intento.plan, CRITERIOS);

    await guardarPlan(supabase, planFinal);

    // (a) columna jsonb CRUDA, leída con la clave de servicio: ni la clave
    // "url" ni ninguna cadena con esquema de URL quedaron escritas.
    const { data: versionCruda, error } = await supabase
      .from("plan_versiones")
      .select("recomendaciones")
      .eq("plan_id", planId)
      .order("version", { ascending: false })
      .limit(1)
      .single();
    if (error) throw new Error(`No se pudo leer la versión: ${error.message}`);
    const crudoTexto = JSON.stringify(versionCruda?.recomendaciones);
    expect(crudoTexto).not.toContain("url");
    expect(crudoTexto).not.toMatch(/https?:\/\//);

    // (c) sigue habiendo una recomendación con sus tres campos -no se ha
    // limpiado tirándola, que dejaría pasar el test por vacío.
    expect(versionCruda?.recomendaciones).toEqual([
      { tipo: "comida", nombre: "Sitio Envenenado", motivo: "El modelo dice que merece la pena." },
    ]);

    // (b) lo mismo sobre recuperarPlan + aPlanPublico, el camino que sirve
    // /api/plan/[id] de verdad.
    const recuperado = await recuperarPlan(supabase, planId);
    expect(recuperado).not.toBeNull();
    const publico = aPlanPublico(recuperado!);
    const publicoTexto = JSON.stringify(publico.recomendaciones);
    expect(publicoTexto).not.toContain("url");
    expect(publicoTexto).not.toMatch(/https?:\/\//);
    expect(publico.recomendaciones).toEqual([
      { tipo: "comida", nombre: "Sitio Envenenado", motivo: "El modelo dice que merece la pena." },
    ]);
  });

  it("un dominio incrustado en el nombre sobrevive como TEXTO tras guardar y recuperar, sin ganar nunca una clave 'url'", async () => {
    const planId = `plan-enl-ac2-nombre-${marca}`;
    const respuestaCruda = JSON.stringify({
      dias: planFixture.dias,
      recomendaciones: [
        {
          tipo: "recinto",
          nombre: "Visita https://otro-malicioso.example ahora",
          motivo: "Recomendado por el modelo.",
        },
      ],
    });

    const intento = ensamblarYValidar(CRITERIOS, planId, respuestaCruda);
    expect(intento.valido).toBe(true);
    if (!intento.valido) return;
    const { plan: planFinal } = postProcesarPlan(intento.plan, CRITERIOS);

    await guardarPlan(supabase, planFinal);

    const { data: versionCruda, error } = await supabase
      .from("plan_versiones")
      .select("recomendaciones")
      .eq("plan_id", planId)
      .order("version", { ascending: false })
      .limit(1)
      .single();
    if (error) throw new Error(`No se pudo leer la versión: ${error.message}`);
    // El dominio viaja como texto dentro de "nombre": no desaparece y no se
    // reescribe. Lo que NO puede pasar es que se cuele una clave "url" aparte.
    expect(versionCruda?.recomendaciones).toEqual([
      { tipo: "recinto", nombre: "Visita https://otro-malicioso.example ahora", motivo: "Recomendado por el modelo." },
    ]);
    expect(versionCruda?.recomendaciones?.[0]).not.toHaveProperty("url");

    const recuperado = await recuperarPlan(supabase, planId);
    const publico = aPlanPublico(recuperado!);
    expect(publico.recomendaciones).toEqual([
      { tipo: "recinto", nombre: "Visita https://otro-malicioso.example ahora", motivo: "Recomendado por el modelo." },
    ]);
    expect(publico.recomendaciones[0]).not.toHaveProperty("url");
  });
});
