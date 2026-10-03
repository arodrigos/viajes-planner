import { beforeAll, describe, expect, it } from "vitest";
import { guardarPlan, recuperarPlan } from "@/lib/plan/repositorio";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import type { Plan } from "@/lib/plan/tipos";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PLAN_ID = "plan-lug-ac1-persistencia";

function planConResolucion(): Plan {
  return {
    id: PLAN_ID,
    version: 1,
    destino: "Madrid",
    personas: 2,
    dias: [
      {
        fecha: "2026-11-07",
        franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
        paradas: [
          {
            id: "p1",
            franja_id: "manana",
            nombre: "Museo del Prado",
            descripcion: "Pinacoteca",
            duracion_min: 120,
            prioridad: 80,
            procedencia: { fuente: "propuesto-sin-verificar" },
            categoria: "museo",
            coordenadas: { lat: 40.4137925, lon: -3.6920407 },
            lugar: {
              fuente: "osm",
              id: "osm:relation/7726080",
              url: "https://www.openstreetmap.org/relation/7726080",
              nombre_fuente: "Museo del Prado",
              etiquetas: { opening_hours: "Mo-Sa 10:00-20:00; Su 10:00-19:00", wikipedia: "es:Museo del Prado" },
              resuelto_en: "2026-10-03T12:00:00.000Z",
            },
            resolucion: { estado: "resuelta", intentado_en: "2026-10-03T12:00:00.000Z" },
          },
          {
            id: "p2",
            franja_id: "manana",
            nombre: "Sitio Inventado Que No Existe",
            descripcion: "No resuelve",
            duracion_min: 60,
            prioridad: 50,
            procedencia: { fuente: "propuesto-sin-verificar" },
            resolucion: { estado: "no-resuelta", intentado_en: "2026-10-03T12:00:00.000Z", motivo: "ningún candidato aceptable" },
          },
        ],
      },
    ],
  };
}

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("persistencia de la resolución de lugares (lug-ac1)", () => {
  const supabase = clienteDePrueba();

  beforeAll(async () => {
    await supabase.from("planes").delete().eq("id", PLAN_ID);
  });

  it("guarda y recupera coordenadas, lugar, categoria y resolucion; la procedencia pública se deriva de `lugar`", async () => {
    await guardarPlan(supabase, planConResolucion());
    const recuperado = await recuperarPlan(supabase, PLAN_ID);
    expect(recuperado).not.toBeNull();

    const [resuelta, noResuelta] = recuperado!.dias[0].paradas;

    expect(resuelta.coordenadas).toEqual({ lat: 40.4137925, lon: -3.6920407 });
    expect(resuelta.categoria).toBe("museo");
    expect(resuelta.lugar?.fuente).toBe("osm");
    expect(resuelta.lugar?.url).toBe("https://www.openstreetmap.org/relation/7726080");
    expect(resuelta.resolucion?.estado).toBe("resuelta");
    // lug-ac1: la procedencia pública NO sale de la tabla `procedencias`
    // (su CHECK solo admite 'propuesto-sin-verificar') sino de `lugar`.
    expect(resuelta.procedencia).toEqual({ fuente: "osm", url: "https://www.openstreetmap.org/relation/7726080" });

    expect(noResuelta.coordenadas).toBeUndefined();
    expect(noResuelta.categoria).toBeUndefined();
    expect(noResuelta.lugar).toBeUndefined();
    expect(noResuelta.resolucion?.estado).toBe("no-resuelta");
    expect(noResuelta.procedencia).toEqual({ fuente: "propuesto-sin-verificar" });
  });
});
