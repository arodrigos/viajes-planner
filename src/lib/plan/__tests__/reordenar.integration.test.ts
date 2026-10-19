import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan, recuperarPlan, reemplazarParadaEnNuevaVersion } from "@/lib/plan/repositorio";
import { marcarVisitada } from "@/lib/plan/visitas";
import type { Parada, Plan } from "@/lib/plan/tipos";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FRANJAS = [
  { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" },
  { id: "comida", etiqueta: "Comida", hora_inicio: "13:00", hora_fin: "15:00" },
  { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:00", hora_fin: "20:00" },
];

function parada(id: string, franja: string): Parada {
  return {
    id,
    franja_id: franja,
    nombre: `Sitio ${id}`,
    descripcion: "Descripción de prueba",
    duracion_min: 60,
    prioridad: 50,
    procedencia: { fuente: "propuesto-sin-verificar" },
    coordenadas: { lat: 37.38, lon: -5.99 },
    alternativas: [
      { nombre: `Alt 1 de ${id}`, descripcion: "d", motivo: "m", duracion_min: 60, categoria: "monumento", origen: "modelo", coordenadas: { lat: 37.39, lon: -5.98 } },
      { nombre: `Alt 2 de ${id}`, descripcion: "d", motivo: "m", duracion_min: 45, categoria: "monumento", origen: "modelo", coordenadas: { lat: 37.4, lon: -5.97 } },
    ],
  };
}

function planDeDosDias(id: string): Plan {
  return {
    id,
    version: 1,
    destino: "Sevilla",
    personas: 2,
    dias: [
      {
        fecha: "2026-11-07",
        franjas: FRANJAS,
        paradas: [parada("p1", "manana"), parada("p2", "manana"), parada("p3", "comida"), parada("p4", "tarde"), parada("p5", "tarde")],
      },
      { fecha: "2026-11-08", franjas: FRANJAS, paradas: [parada("q1", "manana"), parada("q2", "tarde")] },
    ],
  };
}

const ORDEN_DIA0 = [
  { id: "p2", franja_id: "manana" },
  { id: "p1", franja_id: "manana" },
  { id: "p3", franja_id: "comida" },
  { id: "p5", franja_id: "tarde" },
  { id: "p4", franja_id: "tarde" },
];

// El orden de lectura de recuperarPlan lo cambia el bloque reordenar-dia (no
// puede leer la columna antes de que la migración esté aplicada), así que
// aquí el orden se lee de la tabla.
async function filasDelDia(supabase: ReturnType<typeof clienteDePrueba>, planId: string, version: number, dia: number) {
  const { data: v } = await supabase.from("plan_versiones").select("id").eq("plan_id", planId).eq("version", version).single();
  const { data, error } = await supabase
    .from("paradas")
    .select("id_externo, franja_id, orden, dia_index")
    .eq("plan_version_id", v!.id)
    .eq("dia_index", dia);
  expect(error).toBeNull();
  return (data ?? []) as { id_externo: string; franja_id: string; orden: number | null }[];
}

async function contarVersiones(supabase: ReturnType<typeof clienteDePrueba>, planId: string) {
  const { count } = await supabase.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);
  return count ?? 0;
}

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("reordenar_dia_plan (dat-ac2, dat-ac3, dat-ac5)", () => {
  const supabase = clienteDePrueba();
  const sufijo = Date.now();

  async function sembrar(nombre: string) {
    const id = `plan-orden-${nombre}-${sufijo}`;
    await guardarPlan(supabase, planDeDosDias(id));
    return id;
  }

  it("dat-ac2: crea la versión 2 con el día 0 reordenado y todo lo demás igual", async () => {
    const id = await sembrar("dia0");
    expect(await marcarVisitada(supabase, id, "p2")).toBe("marcada");

    const { data, error } = await supabase.rpc("reordenar_dia_plan", { p_plan_id: id, p_version_base: 1, p_dia_index: 0, p_orden: ORDEN_DIA0 });
    expect(error).toBeNull();
    expect((data as { version: number }[])[0].version).toBe(2);

    const dia0 = (await filasDelDia(supabase, id, 2, 0)).sort((a, b) => a.orden! - b.orden!);
    expect(dia0.map((f) => [f.id_externo, f.orden])).toEqual([["p2", 0], ["p1", 1], ["p3", 2], ["p5", 3], ["p4", 4]]);
    expect((await filasDelDia(supabase, id, 2, 1)).every((f) => f.orden === null)).toBe(true);
    expect((await filasDelDia(supabase, id, 1, 0)).every((f) => f.orden === null)).toBe(true);

    const plan = await recuperarPlan(supabase, id);
    expect(plan?.version).toBe(2);
    expect(plan?.dias[0].paradas.every((p) => p.alternativas?.length === 2)).toBe(true);
    expect(plan?.dias[0].paradas.find((p) => p.id === "p2")?.visitada).toBe(true);
    expect(plan?.dias[1].paradas.map((p) => p.id)).toEqual(["q1", "q2"]);
  });

  it("dat-ac2: mover una parada a otra franja deja su franja_id nueva", async () => {
    const id = await sembrar("franja");
    const orden = [
      { id: "p1", franja_id: "manana" },
      { id: "p2", franja_id: "manana" },
      { id: "p4", franja_id: "manana" },
      { id: "p3", franja_id: "comida" },
      { id: "p5", franja_id: "tarde" },
    ];
    const { error } = await supabase.rpc("reordenar_dia_plan", { p_plan_id: id, p_version_base: 1, p_dia_index: 0, p_orden: orden });
    expect(error).toBeNull();
    const dia0 = await filasDelDia(supabase, id, 2, 0);
    expect(dia0.find((f) => f.id_externo === "p4")?.franja_id).toBe("manana");
  });

  it("dat-ac3: rechaza lo desfasado y lo inválido sin crear versión", async () => {
    const id = await sembrar("rechazo");
    const casos: [string, number, number, unknown][] = [
      ["version-desfasada", 9, 0, ORDEN_DIA0],
      ["orden-invalido", 1, 0, [...ORDEN_DIA0.slice(0, 4), { id: "p5", franja_id: "tarde" }]],
      ["orden-invalido", 1, 0, ORDEN_DIA0.slice(0, 4)],
      ["orden-invalido", 1, 0, [...ORDEN_DIA0.slice(0, 4), { id: "q1", franja_id: "tarde" }]],
      ["orden-invalido", 1, 0, [{ id: "p4", franja_id: "tarde" }, { id: "p5", franja_id: "tarde" }, { id: "p1", franja_id: "manana" }, { id: "p2", franja_id: "manana" }, { id: "p3", franja_id: "comida" }]],
      ["orden-invalido", 1, 0, ORDEN_DIA0.map((e) => (e.id === "p3" ? { ...e, franja_id: "noche" } : e))],
      ["orden-invalido", 1, 7, ORDEN_DIA0],
    ];
    for (const [mensaje, base, dia, orden] of casos) {
      const { error } = await supabase.rpc("reordenar_dia_plan", { p_plan_id: id, p_version_base: base, p_dia_index: dia, p_orden: orden });
      expect(error?.message).toContain(mensaje);
      expect(await contarVersiones(supabase, id)).toBe(1);
    }
  });

  it("dat-ac3: de dos llamadas simultáneas con la misma base, una gana y la otra recibe version-desfasada", async () => {
    const id = await sembrar("carrera");
    const otro = clienteDePrueba();
    const otroOrden = [
      { id: "p1", franja_id: "manana" },
      { id: "p2", franja_id: "manana" },
      { id: "p3", franja_id: "comida" },
      { id: "p5", franja_id: "tarde" },
      { id: "p4", franja_id: "tarde" },
    ];
    const [a, b] = await Promise.all([
      supabase.rpc("reordenar_dia_plan", { p_plan_id: id, p_version_base: 1, p_dia_index: 0, p_orden: ORDEN_DIA0 }),
      otro.rpc("reordenar_dia_plan", { p_plan_id: id, p_version_base: 1, p_dia_index: 0, p_orden: otroOrden }),
    ]);
    const errores = [a.error, b.error].filter(Boolean);
    expect(errores.length).toBe(1);
    expect(errores[0]?.message).toContain("version-desfasada");
    expect(await contarVersiones(supabase, id)).toBe(2);
  });

  it("dat-ac5: sustituir tras reordenar conserva el orden", async () => {
    const id = await sembrar("sustituir");
    const { error } = await supabase.rpc("reordenar_dia_plan", { p_plan_id: id, p_version_base: 1, p_dia_index: 0, p_orden: ORDEN_DIA0 });
    expect(error).toBeNull();
    const v2 = await recuperarPlan(supabase, id);
    const p1 = v2!.dias[0].paradas.find((p) => p.id === "p1")!;
    const { version } = await reemplazarParadaEnNuevaVersion(supabase, id, { ...p1, nombre: "Sitio p1 sustituido" });
    expect(version).toBe(3);
    const dia0 = (await filasDelDia(supabase, id, 3, 0)).sort((a, b) => a.orden! - b.orden!);
    expect(dia0.map((f) => f.id_externo)).toEqual(["p2", "p1", "p3", "p5", "p4"]);
    expect(dia0.map((f) => f.orden)).toEqual([0, 1, 2, 3, 4]);
  });

  it("invariante: cualquier orden válido deja orden 0..n-1, franjas sin retroceso y los mismos id", async () => {
    const id = await sembrar("propiedad");
    const indicesFranja = fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 5, maxLength: 5 }).map((a) => [...a].sort());
    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(["p1", "p2", "p3", "p4", "p5"], { minLength: 5, maxLength: 5 }), indicesFranja, async (ids, franjas) => {
        const { data: v } = await supabase.from("plan_versiones").select("version").eq("plan_id", id).order("version", { ascending: false }).limit(1).single();
        const base = v!.version as number;
        const orden = ids.map((idParada, i) => ({ id: idParada, franja_id: FRANJAS[franjas[i]].id }));
        const { error } = await supabase.rpc("reordenar_dia_plan", { p_plan_id: id, p_version_base: base, p_dia_index: 0, p_orden: orden });
        expect(error).toBeNull();
        const filas = (await filasDelDia(supabase, id, base + 1, 0)).sort((a, b) => a.orden! - b.orden!);
        expect(filas.map((f) => f.orden)).toEqual([0, 1, 2, 3, 4]);
        expect(filas.map((f) => f.id_externo)).toEqual(ids);
        expect(filas.map((f) => f.franja_id)).toEqual(orden.map((e) => e.franja_id));
      }),
      { numRuns: 25 },
    );
  });
});
