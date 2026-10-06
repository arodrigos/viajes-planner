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

// alg-ac1 (cp-alg-01): contra la pila real, la guía y las curiosidades viajan
// con el sitio en los dos sentidos y se pasan por guiaSegura/curiosidadesSeguras.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("sustituirParada hereda la guía (alg-ac1)", () => {
  const supabase = clienteDePrueba();
  const planId = `plan-sustituir-guia-${Date.now()}`;
  const FECHA = "2026-10-02T10:00:00.000Z";
  const guia = (consejo: string, url: string) => ({ consejo, url, licencia: "CC BY-SA" as const });

  function plan(): Plan {
    return {
      id: planId,
      version: 1,
      destino: "Londres",
      personas: 2,
      dias: [
        {
          fecha: "2026-11-07",
          franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
          paradas: [
            {
              id: "parada-guia-1",
              franja_id: "manana",
              nombre: "Torre de Londres",
              descripcion: "Fortaleza",
              duracion_min: 120,
              prioridad: 80,
              procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/1" },
              categoria: "monumento",
              coordenadas: { lat: 51.508, lon: -0.076 },
              motivo: "Ideal con niños",
              guia: guia("Consejo T", "https://es.wikivoyage.org/wiki/Londres"),
              curiosidades: { frases: ["T1", "T2"], url: "https://es.wikipedia.org/wiki/Torre_de_Londres" },
              guia_intentada_en: FECHA,
              guia_formato: 2,
              alternativas: [
                {
                  nombre: "Museo de Ciencias",
                  descripcion: "Museo",
                  motivo: "mismo tipo",
                  duracion_min: 120,
                  categoria: "monumento",
                  origen: "modelo",
                  coordenadas: { lat: 51.497, lon: -0.174 },
                  guia: guia("Consejo M", "https://es.wikivoyage.org/wiki/Londres"),
                  curiosidades: { frases: ["M1", "M2", "M3"], url: "https://es.wikipedia.org/wiki/Museo_de_Ciencias" },
                  guia_intentada_en: FECHA,
                  guia_formato: 2,
                },
                { nombre: "Sin guía aún", descripcion: "d", motivo: "m", duracion_min: 60, categoria: "monumento", origen: "cercano", coordenadas: { lat: 51.5, lon: -0.1 } },
              ],
            },
          ],
        },
      ],
    };
  }

  const parada = (p: Plan | null) => p?.dias[0].paradas[0];
  const fecha = (iso: string | undefined) => (iso ? new Date(iso).getTime() : undefined);

  beforeAll(async () => {
    await guardarPlan(supabase, plan());
  });

  it("cp-alg-01: la parada nueva sale con la guía de la alternativa, y al deshacer vuelve la original", async () => {
    const v1 = await recuperarPlan(supabase, planId);
    const museo = parada(v1)?.alternativas?.find((a) => a.nombre === "Museo de Ciencias");
    expect(museo?.guia?.consejo).toBe("Consejo M");
    expect((await sustituirParada(supabase, planId, "parada-guia-1", museo?.id as string)).estado).toBe("sustituida");

    const v2 = parada(await recuperarPlan(supabase, planId));
    expect(v2?.nombre).toBe("Museo de Ciencias");
    expect(v2?.guia?.consejo).toBe("Consejo M");
    expect(v2?.curiosidades?.frases).toEqual(["M1", "M2", "M3"]);
    expect(v2?.curiosidades?.url).toBe("https://es.wikipedia.org/wiki/Museo_de_Ciencias");
    expect(v2?.guia_intentada_en).toBeDefined();
    expect(v2?.motivo).toBeUndefined();
    const torre = v2?.alternativas?.find((a) => a.nombre === "Torre de Londres");
    expect(torre?.guia?.consejo).toBe("Consejo T");
    expect(torre?.curiosidades?.frases).toEqual(["T1", "T2"]);

    expect((await sustituirParada(supabase, planId, "parada-guia-1", torre?.id as string)).estado).toBe("sustituida");
    const v3 = parada(await recuperarPlan(supabase, planId));
    expect(v3?.nombre).toBe("Torre de Londres");
    expect(v3?.guia?.consejo).toBe("Consejo T");
    expect(v3?.curiosidades?.frases).toEqual(["T1", "T2"]);
    expect(v3?.curiosidades?.url).toBe("https://es.wikipedia.org/wiki/Torre_de_Londres");
    expect(fecha(v3?.guia_intentada_en)).toBe(fecha(FECHA));
  });

  it("límite de cp-alg-01: una alternativa sin guía deja la parada nueva pendiente, sin guia", async () => {
    const actual = parada(await recuperarPlan(supabase, planId));
    const sinGuia = actual?.alternativas?.find((a) => a.nombre === "Sin guía aún");
    expect((await sustituirParada(supabase, planId, "parada-guia-1", sinGuia?.id as string)).estado).toBe("sustituida");
    const nueva = parada(await recuperarPlan(supabase, planId));
    expect(nueva?.nombre).toBe("Sin guía aún");
    expect(nueva?.guia).toBeUndefined();
    expect(nueva?.guia_intentada_en).toBeUndefined();
  });
});
