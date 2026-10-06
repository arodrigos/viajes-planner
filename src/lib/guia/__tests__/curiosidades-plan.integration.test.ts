import { beforeEach, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { LimiteDeUsoAlcanzado, type EjecutorModelo } from "@/lib/trabajador/ejecutorModelo";
import { rellenarCuriosidadesPendientes } from "../curiosidadesPlan";
import { FORMATO_GUIA } from "../enriquecer";
import { fuenteGrabada, sitiosLondres } from "../__fixtures__/fuenteGrabada";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// cp-cur-04: el relleno es de una sola invocación por versión, el respaldo
// tiene una única mejora con el modelo y lo ya elegido no se vuelve a pedir.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("curiosidades verificadas en el plan (cp-cur-04)", () => {
  const supabase = clienteDePrueba();
  const PLAN = "plan-curiosidades-cur04";
  let versionId = "";

  beforeEach(async () => {
    await supabase.from("planes").delete().like("id", "plan-curiosidades-%");
    await supabase.from("planes").insert({ id: PLAN, destino: "Londres-cur04" });
    const { data: procedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
    const franjas = [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }];
    const { data: version } = await supabase
      .from("plan_versiones")
      .insert({ plan_id: PLAN, version: 1, personas: 2, dias: [{ fecha: "2026-11-01", franjas }], avisos: [] })
      .select("id")
      .single();
    versionId = version?.id as string;
    const sitios = sitiosLondres();
    const paradasLondres = sitios.filter((s) => s.tipo === "parada");
    const alternativasLondres = sitios.filter((s) => s.tipo === "alternativa");
    const { data: paradas, error } = await supabase
      .from("paradas")
      .insert(
        paradasLondres.map((s, i) => ({
          plan_version_id: versionId,
          id_externo: `cur-${i}`,
          dia_index: 0,
          franja_id: "manana",
          nombre: s.nombre,
          descripcion: "",
          duracion_min: 60,
          prioridad: 50,
          procedencia_id: procedencia?.id,
          lat: 51.5 + i * 0.01,
          lon: -0.12,
          lugar: s.lugar,
          resolucion: { estado: "resuelta", intentado_en: "2026-10-01T00:00:00Z" },
          guia_formato: FORMATO_GUIA,
        })),
      )
      .select("id");
    if (error || !paradas) throw new Error(`No se pudo sembrar: ${error?.message}`);
    const { error: errorAlt } = await supabase.from("paradas_alternativas").insert(
      paradas.flatMap((parada, i) =>
        alternativasLondres.map((s, j) => ({
          parada_id: parada.id,
          origen: "modelo",
          nombre: `${s.nombre} ${i}${j}`,
          descripcion: "d",
          motivo: "m",
          duracion_min: 60,
          categoria: "museo",
          lat: 51.4 + i * 0.01 + j * 0.001,
          lon: -0.12,
          lugar: s.lugar,
          guia_formato: FORMATO_GUIA,
        })),
      ),
    );
    if (errorAlt) throw new Error(`No se pudieron sembrar las alternativas: ${errorAlt.message}`);
  });

  function ejecutorContador(modo: "limite" | "modelo") {
    let invocaciones = 0;
    const ejecutor: EjecutorModelo = {
      async invocar(prompt) {
        invocaciones += 1;
        if (modo === "limite") throw new LimiteDeUsoAlcanzado("2026-10-06T10:00:00Z", 100);
        const claves = [...prompt.matchAll(/^(s\d+) — /gm)].map((m) => m[1]);
        return { texto: JSON.stringify(Object.fromEntries(claves.map((k) => [k, ["c1", "c2"]]))) };
      },
    };
    return { ejecutor, invocaciones: () => invocaciones };
  }

  async function leer() {
    const { data: paradas } = await supabase.from("paradas").select("id, curiosidades").eq("plan_version_id", versionId);
    const { data: alternativas } = await supabase
      .from("paradas_alternativas")
      .select("id, curiosidades")
      .in("parada_id", (paradas ?? []).map((p) => p.id as string));
    return [...(paradas ?? []), ...(alternativas ?? [])] as Array<{ id: string; curiosidades: { items: unknown[]; seleccion: string; mejora_intentada: boolean } | null }>;
  }

  it("límite de uso: 12 sitios con respaldo; un segundo tick los mejora con 1 invocación; el tercero no invoca", async () => {
    const dependencias = (e: EjecutorModelo) => ({ fuente: fuenteGrabada(), ejecutor: e, directorio: process.cwd() });
    const versiones = [{ id: versionId, ciudad: null }];

    const sinCupo = ejecutorContador("limite");
    const r1 = await rellenarCuriosidadesPendientes(supabase, dependencias(sinCupo.ejecutor), versiones);
    expect(r1.invocaciones).toBe(1);
    expect(sinCupo.invocaciones()).toBe(1);
    const tras1 = await leer();
    expect(tras1).toHaveLength(12);
    for (const f of tras1) {
      expect(f.curiosidades?.seleccion).toBe("heuristica");
      expect(f.curiosidades?.items.length).toBeGreaterThan(0);
    }

    const conCupo = ejecutorContador("modelo");
    const r2 = await rellenarCuriosidadesPendientes(supabase, dependencias(conCupo.ejecutor), versiones);
    expect(r2.invocaciones).toBe(1);
    expect(conCupo.invocaciones()).toBe(1);
    const tras2 = await leer();
    expect(tras2).toHaveLength(12);
    for (const f of tras2) expect(f.curiosidades?.seleccion).toBe("modelo");

    const otro = ejecutorContador("modelo");
    const r3 = await rellenarCuriosidadesPendientes(supabase, dependencias(otro.ejecutor), versiones);
    expect(r3.invocaciones).toBe(0);
    expect(otro.invocaciones()).toBe(0);
    expect(await leer()).toEqual(tras2);
  });

  it("una fuente caída pospone la versión sin tocar nada", async () => {
    const fuente = fuenteGrabada();
    const { FalloFuenteCuriosidades } = await import("../fuenteCuriosidades");
    fuente.entidades = async () => {
      throw new FalloFuenteCuriosidades("Wikidata caída");
    };
    const { ejecutor, invocaciones } = ejecutorContador("modelo");
    const r = await rellenarCuriosidadesPendientes(supabase, { fuente, ejecutor, directorio: process.cwd() }, [{ id: versionId, ciudad: null }]);
    expect(r.pospuestas).toBeGreaterThan(0);
    expect(invocaciones()).toBe(0);
    for (const f of await leer()) expect(f.curiosidades).toBeNull();
  });
});
