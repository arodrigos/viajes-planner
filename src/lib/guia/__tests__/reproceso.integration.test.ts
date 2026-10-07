import { beforeEach, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import type { EjecutorModelo } from "@/lib/trabajador/ejecutorModelo";
import type { Lugar } from "@/lib/plan/tipos";
import type { FuenteCuriosidades } from "../candidatas";
import { FORMATO_CURIOSIDADES, rellenarCuriosidadesPendientes } from "../curiosidadesPlan";
import { FORMATO_GUIA } from "../enriquecer";
import { FalloFuenteCuriosidades } from "../fuenteCuriosidades";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ARTICULO = "Test Place is a venue in London.\n\nHe met John F. Kennedy in December 1963 at the venue. It opened to the public in 1910 after long works.";
const LUGAR = { fuente: "osm", id: "node/1", url: "https://www.openstreetmap.org/node/1", nombre_fuente: "Test Place", etiquetas: { wikidata: "Q62378" }, resuelto_en: "2026-10-05T10:00:00Z" } as unknown as Lugar;

function fuenteDoble(articulo: string | null = ARTICULO): FuenteCuriosidades {
  return {
    async entidades() {
      return new Map([["Q62378", { qid: "Q62378", clases: ["Q23413", "Q33506"], titulos: { en: "Test Place" }, hechos: [{ propiedad: "P571" as const, anio: 1066 }] }]]);
    },
    async articulo() {
      return articulo;
    },
    async entradillas() {
      return new Map();
    },
  };
}

// El ejecutor elige todas las candidatas del único sitio: lo que se comprueba
// es qué texto llega a la base, no qué elige el modelo.
function ejecutorContador() {
  let invocaciones = 0;
  const ejecutor: EjecutorModelo = {
    async invocar() {
      invocaciones += 1;
      return { texto: JSON.stringify({ s1: ["c1", "c2", "c3", "c4"] }) };
    },
  };
  return { ejecutor, invocaciones: () => invocaciones };
}

// rp-ac1-a: lo guardado con un formato anterior, incluidas las mitades
// cortadas, se rehace solo con las reglas vigentes.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("reproceso de curiosidades guardadas (rp-ac1)", () => {
  const supabase = clienteDePrueba();
  const PLAN = "plan-curiosidades-reproceso";
  let versionId = "";
  let paradaId = "";

  async function sembrar(curiosidades: unknown) {
    await supabase.from("planes").delete().like("id", "plan-curiosidades-%");
    await supabase.from("planes").insert({ id: PLAN, destino: "Reproceso-ejemplo" });
    const { data: procedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
    const { data: version } = await supabase
      .from("plan_versiones")
      .insert({ plan_id: PLAN, version: 1, personas: 2, dias: [{ fecha: "2026-11-01", franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }] }], avisos: [] })
      .select("id")
      .single();
    versionId = version?.id as string;
    const { data: parada, error } = await supabase
      .from("paradas")
      .insert({
        plan_version_id: versionId,
        id_externo: "rep-0",
        dia_index: 0,
        franja_id: "manana",
        nombre: "Test Place",
        descripcion: "",
        duracion_min: 60,
        prioridad: 50,
        procedencia_id: procedencia?.id,
        lat: 51.5,
        lon: -0.12,
        lugar: LUGAR,
        resolucion: { estado: "resuelta", intentado_en: "2026-10-01T00:00:00Z" },
        guia_formato: FORMATO_GUIA,
        curiosidades,
      })
      .select("id")
      .single();
    if (error || !parada) throw new Error(`No se pudo sembrar: ${error?.message}`);
    paradaId = parada.id as string;
  }

  async function leer() {
    const { data } = await supabase.from("paradas").select("curiosidades").eq("id", paradaId).single();
    return data?.curiosidades as { formato: number; items: Array<{ texto: string }> };
  }

  const guardadaConFormato = (formato: number) => ({
    formato,
    seleccion: "modelo",
    mejora_intentada: true,
    frases: [],
    url: "",
    items: [
      { texto: "Kennedy in December 1963.", idioma: "en", fuente: "wikipedia", url: "https://en.wikipedia.org/wiki/Test_Place", seleccion: "modelo" },
      { texto: "Se fundó en 1066.", idioma: "es", fuente: "wikidata", url: "https://www.wikidata.org/wiki/Q62378", seleccion: "modelo" },
    ],
  });

  beforeEach(() => {
    paradaId = "";
  });

  it("una parada con formato anterior se rehace con 1 invocación y deja la frase completa", async () => {
    await sembrar(guardadaConFormato(FORMATO_CURIOSIDADES - 1));
    const { ejecutor, invocaciones } = ejecutorContador();
    const r = await rellenarCuriosidadesPendientes(supabase, { fuente: fuenteDoble(), ejecutor, directorio: process.cwd() }, [{ id: versionId, ciudad: null }]);
    expect(r.versionesProcesadas).toBe(1);
    expect(r.invocaciones).toBe(1);
    expect(invocaciones()).toBe(1);
    const fila = await leer();
    expect(fila.formato).toBe(FORMATO_CURIOSIDADES);
    const textos = fila.items.map((i) => i.texto);
    expect(textos).not.toContain("Kennedy in December 1963.");
    expect(textos.some((t) => t.startsWith("He met John F. Kennedy in December 1963"))).toBe(true);
  });

  it("tras rehacerla, el segundo pase no la vuelve a tocar (cur-ac3)", async () => {
    await sembrar(guardadaConFormato(FORMATO_CURIOSIDADES - 1));
    const { ejecutor, invocaciones } = ejecutorContador();
    const contexto = { fuente: fuenteDoble(), ejecutor, directorio: process.cwd() };
    await rellenarCuriosidadesPendientes(supabase, contexto, [{ id: versionId, ciudad: null }]);
    expect(invocaciones()).toBe(1);
    const segundo = await rellenarCuriosidadesPendientes(supabase, contexto, [{ id: versionId, ciudad: null }]);
    expect(segundo.invocaciones).toBe(0);
    expect(invocaciones()).toBe(1);
    expect((await leer()).formato).toBe(FORMATO_CURIOSIDADES);
  });

  it("una parada ya en el formato vigente con selección del modelo no se toca", async () => {
    await sembrar(guardadaConFormato(FORMATO_CURIOSIDADES));
    const { ejecutor, invocaciones } = ejecutorContador();
    const r = await rellenarCuriosidadesPendientes(supabase, { fuente: fuenteDoble(), ejecutor, directorio: process.cwd() }, [{ id: versionId, ciudad: null }]);
    expect(r.invocaciones).toBe(0);
    expect(invocaciones()).toBe(0);
    expect((await leer()).items.map((i) => i.texto)).toContain("Kennedy in December 1963.");
  });

  it("si la fuente cae, la fila conserva su formato y sus items", async () => {
    await sembrar(guardadaConFormato(FORMATO_CURIOSIDADES - 1));
    const fuente = fuenteDoble();
    fuente.entidades = async () => {
      throw new FalloFuenteCuriosidades("Wikidata caída");
    };
    const { ejecutor, invocaciones } = ejecutorContador();
    const r = await rellenarCuriosidadesPendientes(supabase, { fuente, ejecutor, directorio: process.cwd() }, [{ id: versionId, ciudad: null }]);
    expect(r.pospuestas).toBe(1);
    expect(invocaciones()).toBe(0);
    const fila = await leer();
    expect(fila.formato).toBe(FORMATO_CURIOSIDADES - 1);
    expect(fila.items).toHaveLength(2);
  });
});
