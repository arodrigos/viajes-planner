import { beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan, recuperarPlan } from "@/lib/plan/repositorio";
import { sustituirParada } from "@/lib/plan/sustituir";
import type { Plan } from "@/lib/plan/tipos";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function planConAlternativa(id: string): Plan {
  return {
    id,
    version: 1,
    destino: "Sevilla",
    personas: 2,
    dias: [
      {
        fecha: "2026-11-07",
        franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
        paradas: [
          {
            id: "parada-sustituir-1",
            franja_id: "manana",
            nombre: "Catedral de Sevilla",
            descripcion: "Visita guiada",
            duracion_min: 90,
            prioridad: 80,
            procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/1" },
            categoria: "monumento",
            coordenadas: { lat: 37.3862, lon: -5.9926 },
            alternativas: [
              {
                nombre: "Real Alcázar",
                descripcion: "Palacio real",
                motivo: "mismo tipo, misma franja",
                duracion_min: 100,
                categoria: "monumento",
                origen: "modelo",
                coordenadas: { lat: 37.3834, lon: -5.9904 },
              },
            ],
          },
        ],
      },
    ],
  };
}

// alt-ac3/alt-ac5: contra la pila real de Supabase (job `persistencia`),
// no un doble -- esto es justo lo que un test con mocks no puede probar:
// que `paradas_alternativas` recibe exactamente las filas esperadas y que
// sustituirParada crea una versión nueva de verdad.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("sustituirParada (alt-ac3, alt-ac5, alt-ac6)", () => {
  const supabase = clienteDePrueba();
  const planId = `plan-sustituir-${Date.now()}`;

  beforeAll(async () => {
    await guardarPlan(supabase, planConAlternativa(planId));
  });

  it("guarda la alternativa en paradas_alternativas al guardar el plan", async () => {
    // Filtrar solo por nombre es ambiguo: el PR #77 añadió otro plan de
    // prueba (route.integration.test.ts) con una alternativa que se llama
    // igual. Hay que acotar a la parada de ESTE plan.
    const { data: version, error: errorVersion } = await supabase
      .from("plan_versiones")
      .select("id")
      .eq("plan_id", planId)
      .order("version", { ascending: false })
      .limit(1)
      .single();
    expect(errorVersion).toBeNull();
    const { data: parada, error: errorParada } = await supabase
      .from("paradas")
      .select("id")
      .eq("plan_version_id", version!.id)
      .eq("id_externo", "parada-sustituir-1")
      .single();
    expect(errorParada).toBeNull();

    const { data, error } = await supabase
      .from("paradas_alternativas")
      .select("nombre, origen, categoria")
      .eq("parada_id", parada!.id);
    expect(error).toBeNull();
    expect(data).toEqual([{ nombre: "Real Alcázar", origen: "modelo", categoria: "monumento" }]);
  });

  it("crea una versión nueva con la parada sustituida y la antigua como alternativa", async () => {
    const antes = await recuperarPlan(supabase, planId);
    const alternativaId = antes?.dias[0].paradas[0].alternativas?.[0].id;
    expect(alternativaId).toBeTruthy();

    const resultado = await sustituirParada(supabase, planId, "parada-sustituir-1", alternativaId as string);
    expect(resultado).toEqual({ estado: "sustituida", version: (antes?.version ?? 1) + 1 });

    const despues = await recuperarPlan(supabase, planId);
    const paradaNueva = despues?.dias[0].paradas[0];
    expect(paradaNueva?.id).toBe("parada-sustituir-1");
    expect(paradaNueva?.nombre).toBe("Real Alcázar");
    expect(paradaNueva?.alternativas).toHaveLength(1);
    expect(paradaNueva?.alternativas?.[0].nombre).toBe("Catedral de Sevilla");
  });

  it("un alternativa_id que no pertenece a la parada responde 'alternativa-invalida'", async () => {
    const resultado = await sustituirParada(supabase, planId, "parada-sustituir-1", "00000000-0000-0000-0000-000000000000");
    expect(resultado).toEqual({ estado: "alternativa-invalida" });
  });

  it("un plan que no existe responde 'no-encontrado'", async () => {
    const resultado = await sustituirParada(supabase, "plan-que-no-existe", "parada-x", "alt-x");
    expect(resultado).toEqual({ estado: "no-encontrado" });
  });
});

// alc-ac1: contra la pila real -- la versión nueva hereda las alternativas
// no elegidas y la sustituida, y se puede volver con otro «Usar esta».
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("sustituirParada conserva las alternativas (alc-ac1)", () => {
  const supabase = clienteDePrueba();
  const planId = `plan-sustituir-alc-${Date.now()}`;

  function planConDosAlternativas(): Plan {
    const base = planConAlternativa(planId);
    const parada = base.dias[0].paradas[0];
    return {
      ...base,
      dias: [
        {
          ...base.dias[0],
          paradas: [
            {
              ...parada,
              nombre: "Real Alcázar",
              alternativas: [
                { nombre: "Casa de Pilatos", descripcion: "d", motivo: "m", duracion_min: 90, categoria: "monumento", origen: "modelo", coordenadas: { lat: 37.3925, lon: -5.9906 } },
                { nombre: "Palacio de las Dueñas", descripcion: "d", motivo: "m", duracion_min: 60, categoria: "monumento", origen: "cercano", coordenadas: { lat: 37.3989, lon: -5.9902 } },
              ],
            },
          ],
        },
      ],
    };
  }

  const nombresDeAlternativas = (plan: Plan | null) => (plan?.dias[0].paradas[0].alternativas ?? []).map((a) => a.nombre).sort();

  beforeAll(async () => {
    await guardarPlan(supabase, planConDosAlternativas());
  });

  it("ida y vuelta: ninguna versión pierde alternativas y la parada nueva nunca pasa de 3", async () => {
    const v1 = await recuperarPlan(supabase, planId);
    const pilatos = v1?.dias[0].paradas[0].alternativas?.find((a) => a.nombre === "Casa de Pilatos");
    expect((await sustituirParada(supabase, planId, "parada-sustituir-1", pilatos?.id as string)).estado).toBe("sustituida");

    const v2 = await recuperarPlan(supabase, planId);
    expect(v2?.dias[0].paradas[0].nombre).toBe("Casa de Pilatos");
    expect(nombresDeAlternativas(v2)).toEqual(["Palacio de las Dueñas", "Real Alcázar"]);

    const alcazar = v2?.dias[0].paradas[0].alternativas?.find((a) => a.nombre === "Real Alcázar");
    expect((await sustituirParada(supabase, planId, "parada-sustituir-1", alcazar?.id as string)).estado).toBe("sustituida");

    const v3 = await recuperarPlan(supabase, planId);
    expect(v3?.dias[0].paradas[0].nombre).toBe("Real Alcázar");
    expect(nombresDeAlternativas(v3)).toEqual(["Casa de Pilatos", "Palacio de las Dueñas"]);

    // Las versiones anteriores siguen intactas.
    expect(nombresDeAlternativas(await recuperarPlan(supabase, planId, 1))).toEqual(["Casa de Pilatos", "Palacio de las Dueñas"]);
    expect(nombresDeAlternativas(await recuperarPlan(supabase, planId, 2))).toEqual(["Palacio de las Dueñas", "Real Alcázar"]);
  });
});
