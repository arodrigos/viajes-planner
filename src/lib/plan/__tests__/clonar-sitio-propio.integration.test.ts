import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan, recuperarPlan } from "@/lib/plan/repositorio";
import type { Parada, Plan } from "@/lib/plan/tipos";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FRANJAS = [
  { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" },
  { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:00", hora_fin: "20:00" },
];

function parada(id: string, franja: string): Parada {
  return { id, franja_id: franja, nombre: `Sitio ${id}`, descripcion: "Descripción", duracion_min: 60, prioridad: 50, procedencia: { fuente: "propuesto-sin-verificar" }, coordenadas: { lat: 37.38, lon: -5.99 } };
}

function plan(id: string): Plan {
  return { id, version: 1, destino: "Sevilla", personas: 2, dias: [{ fecha: "2026-11-07", franjas: FRANJAS, paradas: [parada("a", "manana"), parada("b", "tarde")] }] };
}

let contador = 0;

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("funciones de sitio propio (spd-ac1, spd-ac5)", () => {
  const servicio = clienteDePrueba("servicio");

  async function sembrar() {
    const planId = `plan-clonar-propio-${Date.now()}-${contador++}`;
    await guardarPlan(servicio, plan(planId));
    return planId;
  }

  async function anadir(planId: string, version: number, nombre: string, nota: string | null) {
    const { data, error } = await servicio.rpc("anadir_sitio_propio", { p_plan_id: planId, p_version_base: version, p_dia_index: 0, p_nombre: nombre, p_nota: nota });
    if (error) throw new Error(error.message);
    return (data as { version: number; id_externo: string }[])[0];
  }

  async function parcial(planId: string, version?: number) {
    const p = await recuperarPlan(servicio, planId, version);
    return p!.dias[0].paradas;
  }

  it("clonar_version_plan copia nota y propia a la versión nueva", async () => {
    const planId = await sembrar();
    const { id_externo } = await anadir(planId, 1, "Casa Fassi", "Mesa junto a la ventana");
    const { error } = await servicio.rpc("clonar_version_plan", { p_plan_id: planId });
    expect(error).toBeNull();
    const ultima = await recuperarPlan(servicio, planId);
    const propia = ultima!.dias[0].paradas.find((p) => p.id === id_externo);
    expect(propia).toMatchObject({ propia: true, nota: "Mesa junto a la ventana" });
  });

  it("el rol anónimo no puede ejecutar ninguna de las tres funciones", async () => {
    const planId = await sembrar();
    for (const rol of ["anonimo"] as const) {
      const cliente = clienteDePrueba(rol);
      const llamadas = [
        cliente.rpc("anadir_sitio_propio", { p_plan_id: planId, p_version_base: 1, p_dia_index: 0, p_nombre: "Casa Fassi", p_nota: null }),
        cliente.rpc("corregir_sitio_propio", { p_plan_id: planId, p_version_base: 1, p_id_externo: "propia-00000000", p_nombre: "Otro" }),
        cliente.rpc("quitar_sitio_propio", { p_plan_id: planId, p_version_base: 1, p_id_externo: "propia-00000000" }),
      ];
      for (const { error } of await Promise.all(llamadas)) expect(error).not.toBeNull();
    }
    const { count } = await servicio.from("plan_versiones").select("id", { count: "exact", head: true }).eq("plan_id", planId);
    expect(count).toBe(1);
  });

  it("invariantes: la versión nueva es la anterior más una parada propia, la anterior no cambia, ids únicos y la nota byte a byte (propiedad)", async () => {
    const nombre = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{1,30}$/);
    const nota = fc.option(fc.string({ minLength: 1, maxLength: 200 }).filter((t) => !/[\u0000-\u001f\u007f-\u009f]/.test(t) && t.trim() === t && t !== ""), { nil: null });
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(nombre, nota), { minLength: 1, maxLength: 3 }), async (sitios) => {
        const planId = await sembrar();
        const antes = await parcial(planId, 1);
        const ids: string[] = [];
        let version = 1;
        for (const [n, nt] of sitios) {
          const previa = await parcial(planId, version);
          const r = await anadir(planId, version, n, nt);
          version = r.version;
          ids.push(r.id_externo);
          const nueva = await parcial(planId, version);
          expect(nueva).toHaveLength(previa.length + 1);
          expect(nueva.filter((p) => p.id !== r.id_externo).map((p) => p.id).sort()).toEqual(previa.map((p) => p.id).sort());
          expect(nueva.find((p) => p.id === r.id_externo)?.nota).toBe(nt ?? undefined);
          // La versión anterior sigue exactamente como estaba.
          expect(await parcial(planId, version - 1)).toEqual(previa);
        }
        expect(new Set(ids).size).toBe(ids.length);
        // Añadir y quitar deja el día como al principio.
        let v = version;
        for (const id of ids) {
          const { data, error } = await servicio.rpc("quitar_sitio_propio", { p_plan_id: planId, p_version_base: v, p_id_externo: id });
          expect(error).toBeNull();
          v = (data as { version: number }[])[0].version;
        }
        const final = await parcial(planId, v);
        expect(final.map((p) => ({ id: p.id, nombre: p.nombre, franja: p.franja_id }))).toEqual(antes.map((p) => ({ id: p.id, nombre: p.nombre, franja: p.franja_id })));
      }),
      { numRuns: 5 },
    );
  });
});
