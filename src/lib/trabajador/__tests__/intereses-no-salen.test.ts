import { describe, expect, it } from "vitest";
import { resolverAlternativasPlan } from "@/lib/alternativas/resolverAlternativas";
import type { FuenteCercanos } from "@/lib/alternativas/cercanos";
import { ETIQUETA_INTERES, INTERESES } from "@/lib/criterios/intereses";
import type { CriteriosViaje } from "@/lib/criterios/tipos";
import { resolverPlan } from "@/lib/lugares/resolverPlan";
import type { FuenteLugares } from "@/lib/lugares/tipos";
import { planFixture } from "@/lib/plan/__fixtures__/plan-5-dias-4-personas";
import { construirPrompt } from "@/lib/trabajador/prompt";
import type { Plan } from "@/lib/plan/tipos";

const CRITERIOS: CriteriosViaje = {
  destino_o_tipo: "Sevilla",
  fechas: { modo: "epoca", epoca: "primavera" },
  dias: 5,
  personas: [{ edad: 40 }, { edad: 8 }],
  perfil: "familiar",
  presupuesto_eur: 1500,
  ritmo: "tranquilo",
  intereses: ["museos", "gastronomia", "compras"],
};

const BUSCADOS = [...INTERESES, ...INTERESES.map((i) => ETIQUETA_INTERES[i])];

// rit-ac4: la fuente de lugares y la de cercanos se llaman con nombre,
// cualificador, caja y categoría de la parada. El test registra todo lo que
// ven, tal cual, y busca en ello cada id y cada etiqueta de interés.
describe("los intereses no salen hacia las fuentes externas (rit-ac4)", () => {
  it("ninguna petición a lugares ni a cercanos contiene un interés; el prompt del modelo sí", async () => {
    const peticiones: string[] = [];
    const caja = { minLat: 37, maxLat: 38, minLon: -6.1, maxLon: -5.8 };
    const lugares: FuenteLugares = {
      async geocodificarDestino(destino) {
        peticiones.push(JSON.stringify({ destino }));
        return caja;
      },
      async buscarNominatim(nombre, cualificador, bbox) {
        peticiones.push(JSON.stringify({ nombre, cualificador, bbox }));
        return [];
      },
      async buscarWikipedia(nombre, cualificador, bbox) {
        peticiones.push(JSON.stringify({ nombre, cualificador, bbox }));
        return [];
      },
    };
    const cercanos: FuenteCercanos = {
      async buscar(categoria, lat, lon, radioM) {
        peticiones.push(JSON.stringify({ categoria, lat, lon, radioM }));
        return [];
      },
    };

    const base = planFixture;
    const plan: Plan = {
      ...base,
      dias: base.dias.map((d) => ({ ...d, paradas: d.paradas.map((p) => ({ ...p, categoria: "museo" as const })) })),
    };
    const resuelto = await resolverPlan(lugares, plan);
    await resolverAlternativasPlan(lugares, cercanos, resuelto, CRITERIOS.perfil);

    expect(peticiones.length).toBeGreaterThan(0);
    const todo = peticiones.join("\n");
    for (const buscado of BUSCADOS) expect(todo, buscado).not.toContain(buscado);

    const prompt = construirPrompt(CRITERIOS);
    for (const etiqueta of ["Museos", "Gastronomía", "Compras"]) expect(prompt).toContain(etiqueta);
  });
});
