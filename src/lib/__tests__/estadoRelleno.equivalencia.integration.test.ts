import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { FORMATO_CURIOSIDADES } from "@/lib/guia/curiosidadesPlan";
import { guardarPlan } from "@/lib/plan/repositorio";
import { calcularRellenoReferencia } from "./referenciaRelleno";
import type { Plan } from "@/lib/plan/tipos";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PREFIJO = "equiv-relleno-";

const item = { texto: "Una curiosidad de ejemplo.", idioma: "es", fuente: "wikipedia", url: "https://es.wikipedia.org/wiki/Ejemplo", seleccion: "modelo" };

// Todas las formas de `curiosidades` que el recuento antiguo distingue: sin
// valor, de otro tipo, sin items, con items y formato antiguo, sin formato y
// vigente.
const curiosidades = fc.constantFrom<unknown>(
  null,
  "texto",
  { items: [] },
  { formato: 1, items: [] },
  { formato: FORMATO_CURIOSIDADES - 1, items: [item] },
  { items: [item] },
  { formato: "6", items: [item] },
  { formato: FORMATO_CURIOSIDADES, items: [item] },
  { formato: FORMATO_CURIOSIDADES + 1, items: [item] },
);

const resolucion = fc.constantFrom<unknown>(
  null,
  { estado: "resuelta" },
  { estado: "no-resuelta" },
  { estado: "error" },
);
const motivoParada = fc.constantFrom<string | null>(null, "", "Ideal con niños");
const categoriaCiudad = fc.constantFrom<unknown>(
  null,
  { estado: "resuelta" },
  { estado: "sin-ciudad-identificable", categoria_motivo: "sin-caja" },
  { estado: "sin-ciudad-identificable", categoria_motivo: "zona-grande" },
  { estado: "sin-ciudad-identificable", categoria_motivo: "sin-candidato-claro" },
  { estado: "sin-ciudad-identificable", categoria_motivo: "ciudad-no-encontrada" },
);

const parada = fc.record({
  resolucion,
  foto: fc.boolean(),
  categoria: fc.boolean(),
  guia: fc.boolean(),
  motivo: motivoParada,
  curiosidades,
  alternativas: fc.array(curiosidades, { maxLength: 2 }),
});
const version = fc.record({
  etapas: fc.constantFrom<unknown>(null, [], [{ n: 1 }, { n: 2 }]),
  eventos: fc.boolean(),
  paradas: fc.array(parada, { maxLength: 3 }),
});
const mundo = fc.array(
  fc.record({
    ciudad: categoriaCiudad,
    versiones: fc.array(version, { minLength: 0, maxLength: 3 }),
    trabajos: fc.array(fc.record({ inviable: fc.boolean(), eliminado: fc.boolean() }), { maxLength: 2 }),
  }),
  { maxLength: 4 },
);

function planVacio(id: string, nombres: string[]): Plan {
  return {
    id,
    version: 1,
    destino: "Destino de control",
    personas: 2,
    dias: [
      {
        fecha: "2026-11-01",
        franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
        paradas: nombres.map((nombre) => ({
          id: nombre,
          franja_id: "manana",
          nombre,
          descripcion: "",
          duracion_min: 60,
          prioridad: 50,
          procedencia: { fuente: "propuesto-sin-verificar" as const },
          categoria: "monumento" as const,
        })),
      },
    ],
  };
}

// sal-ac2: estado_relleno() (SQL) tiene que devolver exactamente lo mismo que
// la implementación anterior en TypeScript, para cualquier contenido de las
// tablas; no solo para el ejemplo sembrado de los otros tests.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("estado_relleno() equivale a la implementación anterior (sal-ac2)", () => {
  const supabase = clienteDePrueba();

  beforeEach(async () => {
    await supabase.from("planes").delete().not("id", "is", null);
  });

  it("da los mismos veintiséis valores con datos generados", async () => {
    await fc.assert(
      fc.asyncProperty(mundo, async (planes) => {
        await supabase.from("planes").delete().not("id", "is", null);
        for (const [i, p] of planes.entries()) {
          const planId = `${PREFIJO}${i}`;
          if (p.versiones.length === 0) {
            const { error } = await supabase.from("planes").insert({ id: planId, destino: "Sin versión" });
            if (error) throw new Error(error.message);
          }
          for (const [j, v] of p.versiones.entries()) {
            const nombres = v.paradas.map((_, k) => `p${i}v${j}s${k}`);
            await guardarPlan(supabase, planVacio(planId, nombres));
            await supabase
              .from("plan_versiones")
              .update({ etapas: v.etapas, eventos_intentados_en: v.eventos ? new Date().toISOString() : null })
              .eq("plan_id", planId)
              .eq("version", j + 1);
            for (const [k, par] of v.paradas.entries()) {
              const { data, error } = await supabase
                .from("paradas")
                .update({
                  resolucion: par.resolucion,
                  foto: par.foto ? { url: "https://example.com/f.jpg" } : null,
                  categoria: par.categoria ? "monumento" : null,
                  guia: par.guia ? { consejos: [] } : null,
                  motivo: par.motivo,
                  curiosidades: par.curiosidades,
                })
                .eq("id_externo", nombres[k])
                .select("id")
                .single();
              if (error || !data) throw new Error(error?.message ?? "sin parada");
              if (par.alternativas.length > 0) {
                const { error: errorAlt } = await supabase.from("paradas_alternativas").insert(
                  par.alternativas.map((c, n) => ({
                    parada_id: data.id,
                    origen: "cercano",
                    nombre: `alt-${n}`,
                    descripcion: "d",
                    motivo: "m",
                    duracion_min: 30,
                    categoria: "monumento",
                    curiosidades: c,
                  })),
                );
                if (errorAlt) throw new Error(errorAlt.message);
              }
            }
          }
          if (p.ciudad !== null) await supabase.from("planes").update({ ciudad: p.ciudad }).eq("id", planId);
          for (const t of p.trabajos) {
            const { error } = await supabase.from("trabajos").insert({
              tipo: "generacion",
              estado: "completado",
              criterios: {},
              plan_id: planId,
              inviable: t.inviable ? { razones: ["x"] } : null,
              eliminado_en: t.eliminado ? new Date().toISOString() : null,
            });
            if (error) throw new Error(error.message);
          }
        }

        const referencia = await calcularRellenoReferencia(supabase);
        const { data, error } = await supabase.rpc("estado_relleno", { p_formato_curiosidades: FORMATO_CURIOSIDADES });
        expect(error).toBeNull();
        expect(data).toEqual(referencia);
      }),
      { numRuns: 12 },
    );
  }, 120_000);
});
