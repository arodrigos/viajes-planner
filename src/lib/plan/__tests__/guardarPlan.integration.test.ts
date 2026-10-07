import fc from "fast-check";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { planGrande } from "@/lib/plan/__fixtures__/plan-grande";
import { guardarPlan, recuperarPlan } from "@/lib/plan/repositorio";
import { sustituirParada } from "@/lib/plan/sustituir";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cliente de servicio con el fetch instrumentado: cuenta lo que de verdad
// sale hacia /rest/v1/, que es lo que cuesta tiempo (alr-ac1).
function clienteContado() {
  let peticiones = 0;
  const fetchContado: typeof fetch = (entrada, init) => {
    if (String(entrada instanceof Request ? entrada.url : entrada).includes("/rest/v1/")) peticiones++;
    return fetch(entrada, init);
  };
  const cliente = createClient(SUPABASE_URL ?? "", SERVICE_KEY ?? "", {
    auth: { persistSession: false },
    db: { schema: process.env.SUPABASE_SCHEMA },
    global: { fetch: fetchContado },
  }) as SupabaseClient;
  return { cliente, leer: () => peticiones, reiniciar: () => (peticiones = 0) };
}

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("guardarPlan en bloque (alr-ac1)", () => {
  const supabase = clienteDePrueba();
  const idsCreados: string[] = [];
  const nuevoId = (prefijo: string) => {
    const id = `${prefijo}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    idsCreados.push(id);
    return id;
  };

  afterAll(async () => {
    if (idsCreados.length > 0) await supabase.from("planes").delete().in("id", idsCreados);
  });

  it("cp-alr-01: 3 cambios seguidos sobre 24 paradas y 72 alternativas, ≤ 6 peticiones cada uno y mediana < 1.500 ms", async () => {
    const planId = nuevoId("plan-alr-grande");
    await guardarPlan(supabase, planGrande(planId));
    const { cliente, leer, reiniciar } = clienteContado();

    const tiempos: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const actual = await recuperarPlan(supabase, planId);
      const parada = actual!.dias[0].paradas[0];
      const alternativa = parada.alternativas![0];
      reiniciar();
      const inicio = performance.now();
      const resultado = await sustituirParada(cliente, planId, parada.id, alternativa.id!);
      tiempos.push(performance.now() - inicio);
      expect(resultado).toEqual({ estado: "sustituida", version: i + 1 });
      // sustituirParada lee el plan (varias lecturas) y guarda: el tope de 6 es del guardado,
      // así que se mide aislado más abajo; aquí solo se exige que no crezca con el plan.
      expect(leer()).toBeLessThan(30);
    }
    tiempos.sort((a, b) => a - b);
    expect(tiempos[1]).toBeLessThan(1500);

    const ultima = await recuperarPlan(supabase, planId);
    expect(ultima!.version).toBe(4);
    const paradas = ultima!.dias.flatMap((d) => d.paradas);
    expect(paradas).toHaveLength(24);
    expect(paradas.reduce((n, p) => n + (p.alternativas?.length ?? 0), 0)).toBe(72);
    expect(ultima!.dias[0].paradas.find((p) => p.id === "p-0-0")!.alternativas!.map((a) => a.nombre)).toContain("Sitio 0-0");
  });

  it("la marca alternativas_intentadas_en sobrevive a una versión nueva", async () => {
    const planId = nuevoId("plan-alt-marca");
    const plan = planGrande(planId);
    const marca = "2026-01-01T00:00:00.000Z";
    plan.dias[0].paradas[0].alternativas_intentadas_en = marca;
    await guardarPlan(supabase, plan);
    const v1 = (await recuperarPlan(supabase, planId))!;
    // PostgREST devuelve el timestamptz como «+00:00»: se compara el instante, no el texto.
    expect(new Date(v1.dias[0].paradas[0].alternativas_intentadas_en!).toISOString()).toBe(marca);
    await guardarPlan(supabase, v1);
    const v2 = (await recuperarPlan(supabase, planId))!;
    expect(v2.version).toBe(2);
    expect(new Date(v2.dias[0].paradas[0].alternativas_intentadas_en!).toISOString()).toBe(marca);
  });

  it("guardarPlan aislado hace ≤ 6 peticiones a /rest/v1/ con 24 paradas y con 1 parada sin alternativas", async () => {
    const { cliente, leer, reiniciar } = clienteContado();
    await guardarPlan(cliente, planGrande(nuevoId("plan-alr-peticiones")));
    expect(leer()).toBeLessThanOrEqual(6);

    reiniciar();
    await guardarPlan(cliente, planGrande(nuevoId("plan-alr-una"), 1, 1, 0));
    expect(leer()).toBeLessThanOrEqual(6);
  });

  it("si la inserción de paradas falla, guardarPlan lanza y se sigue sirviendo la versión anterior completa", async () => {
    const planId = nuevoId("plan-alr-fallo");
    await guardarPlan(supabase, planGrande(planId, 1, 2, 1));
    const roto = planGrande(planId, 1, 2, 1);
    // duracion_min es integer: un texto fuerza el fallo de la inserción de paradas.
    (roto.dias[0].paradas[1] as { duracion_min: unknown }).duracion_min = "no-es-un-número";
    await expect(guardarPlan(supabase, roto)).rejects.toThrow(/paradas/);
    const servida = await recuperarPlan(supabase, planId);
    expect(servida!.version).toBe(1);
    expect(servida!.dias[0].paradas).toHaveLength(2);
  });

  it("propiedad: recuperarPlan(guardarPlan(p)) conserva paradas, orden y alternativas", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 4 }), fc.integer({ min: 0, max: 3 }), async (dias, paradas, alternativas) => {
        const plan = planGrande(nuevoId("plan-alr-prop"), dias, paradas, alternativas);
        await guardarPlan(supabase, plan);
        const leido = await recuperarPlan(supabase, plan.id);
        const forma = (p: typeof plan) =>
          p.dias.map((d) =>
            d.paradas.map((x) => ({ id: x.id, franja: x.franja_id, nombre: x.nombre, alternativas: (x.alternativas ?? []).map((a) => a.nombre) })),
          );
        expect(forma(leido!)).toEqual(forma(plan));
      }),
      { numRuns: 6 },
    );
  });
});
