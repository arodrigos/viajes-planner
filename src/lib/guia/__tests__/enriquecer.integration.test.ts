import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { cacheSitiosMemoria } from "@/lib/lugares/cacheSitios";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import { crearFuenteFotosGrabada } from "@/lib/lugares/fuenteFotosGrabada";
import type { Reloj } from "@/lib/lugares/limitador";
import { guardarPlan } from "@/lib/plan/repositorio";
import type { Plan } from "@/lib/plan/tipos";
import { enriquecerGuiaDePlan } from "../enriquecer";
import { crearFuenteGuiaAbierta } from "../wikivoyage";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CIUDAD: CiudadEfectiva = { estado: "resuelta", metodo: "destino", nombre: "Sevilla", caja: { minLat: 37, maxLat: 38, minLon: -6.1, maxLon: -5.9 }, intentado_en: "2026-10-01T00:00:00Z" };
const grabado = (n: string) => readFileSync(join(process.cwd(), "fixtures/guia", n), "utf8");
const EXTRACTO = (JSON.parse(grabado("es-wikipedia-real-alcazar.json")) as { extract: string }).extract;

const reloj: Reloj = { ahora: () => Date.parse("2026-10-05T12:00:00Z"), dormir: async () => undefined };

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("enriquecimiento de la guía (gui-ac1, gui-ac2)", () => {
  const supabase = clienteDePrueba();

  beforeEach(async () => {
    await supabase.from("planes").delete().like("id", "plan-gui-%");
  });

  it("cp-gui-01: la ficha se asigna, el precio de la guía sustituye al estimado y la sin-ficha se marca intentada", async () => {
    const pagina = JSON.stringify({
      query: { pages: [{ title: "Seville", revisions: [{ slots: { main: { content: "{{see|name=Real Alcázar|price=€10, under 12 free|content=Patios y jardines.}}" } } }] }] },
    });
    const peticiones: string[] = [];
    const fuenteGuia = crearFuenteGuiaAbierta({
      reloj,
      cache: cacheSitiosMemoria(),
      fetch: (async (url: RequestInfo | URL) => {
        peticiones.push(String(url));
        return new Response(pagina, { status: 200 });
      }) as typeof fetch,
    });
    const fuenteFotos = crearFuenteFotosGrabada({
      paginas: { "es:Real Alcázar de Sevilla": { extracto: EXTRACTO } },
      imagenes: {},
    });
    const plan: Plan = {
      id: "plan-gui-sevilla",
      version: 1,
      destino: "Sevilla",
      personas: 2,
      ciudad: CIUDAD,
      dias: [
        {
          fecha: "2026-11-01",
          franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
          paradas: ["Real Alcázar de Sevilla", "Bar sin ficha"].map((nombre) => ({
            id: `${nombre}-id`,
            franja_id: "manana",
            nombre,
            descripcion: "",
            duracion_min: 60,
            prioridad: 50,
            procedencia: { fuente: "propuesto-sin-verificar" as const },
          })),
        },
      ],
    };
    await guardarPlan(supabase, plan);
    const { data: filas } = await supabase.from("paradas").select("id, nombre").in("nombre", ["Real Alcázar de Sevilla", "Bar sin ficha"]);
    const idPorNombre = new Map((filas ?? []).map((f) => [f.nombre as string, f.id as string]));
    const resuelta = { estado: "resuelta", intentado_en: "2026-10-01T00:00:00Z" };
    const lugarAlcazar = { fuente: "wikipedia", id: "wikipedia:es:Real Alcázar de Sevilla", url: "https://es.wikipedia.org/wiki/Real_Alc%C3%A1zar_de_Sevilla", nombre_fuente: "Real Alcázar de Sevilla", etiquetas: {}, resuelto_en: "2026-10-01T00:00:00Z" };
    await supabase.from("paradas").update({ lat: 37.383, lon: -5.99, resolucion: resuelta, lugar: lugarAlcazar }).eq("id", idPorNombre.get("Real Alcázar de Sevilla"));
    await supabase.from("paradas").update({ lat: 37.5, lon: -5.9, resolucion: resuelta }).eq("id", idPorNombre.get("Bar sin ficha"));

    const resultado = await enriquecerGuiaDePlan(supabase, { fuenteGuia, fuenteFotos, reloj }, "plan-gui-sevilla");
    expect(resultado).toMatchObject({ intentadas: 2, con_guia: 1, con_curiosidades: 1, pospuestas: 0 });

    const { data } = await supabase.from("paradas").select("nombre, guia, curiosidades, coste, guia_intentada_en").in("nombre", ["Real Alcázar de Sevilla", "Bar sin ficha"]);
    const alcazar = data?.find((f) => f.nombre === "Real Alcázar de Sevilla");
    expect(alcazar?.guia).toMatchObject({ consejo: "Patios y jardines.", precio_eur: 10, licencia: "CC BY-SA", url: "https://en.wikivoyage.org/wiki/Seville" });
    expect(alcazar?.coste).toMatchObject({ importe_eur: 10, por: "persona", procedencia: "wikivoyage" });
    expect((alcazar?.curiosidades as { frases: string[] }).frases).toHaveLength(2);
    const bar = data?.find((f) => f.nombre === "Bar sin ficha");
    expect(bar?.guia).toBeNull();
    expect(bar?.guia_intentada_en).not.toBeNull();

    // Segunda pasada: nada pendiente, ninguna petición nueva.
    const antes = peticiones.length;
    const otra = await enriquecerGuiaDePlan(supabase, { fuenteGuia, fuenteFotos, reloj }, "plan-gui-sevilla");
    expect(otra.intentadas).toBe(0);
    expect(peticiones.length).toBe(antes);
  });

  it("gui-ac3: un 429 de la fuente deja guia_intentada_en a null", async () => {
    const fuenteGuia = crearFuenteGuiaAbierta({ reloj, cache: cacheSitiosMemoria(), fetch: (async () => new Response("", { status: 429 })) as typeof fetch });
    const plan: Plan = {
      id: "plan-gui-429",
      version: 1,
      destino: "Sevilla",
      personas: 2,
      ciudad: CIUDAD,
      dias: [
        {
          fecha: "2026-11-01",
          franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
          paradas: [{ id: "a", franja_id: "manana", nombre: "Giralda 429", descripcion: "", duracion_min: 60, prioridad: 50, procedencia: { fuente: "propuesto-sin-verificar" as const } }],
        },
      ],
    };
    await guardarPlan(supabase, plan);
    await supabase.from("paradas").update({ lat: 37.38, lon: -5.99, resolucion: { estado: "resuelta", intentado_en: "2026-10-01T00:00:00Z" } }).eq("nombre", "Giralda 429");
    const r = await enriquecerGuiaDePlan(supabase, { fuenteGuia, fuenteFotos: crearFuenteFotosGrabada({ paginas: {}, imagenes: {} }), reloj }, "plan-gui-429");
    expect(r).toMatchObject({ intentadas: 0, pospuestas: 1 });
    const { data } = await supabase.from("paradas").select("guia_intentada_en").eq("nombre", "Giralda 429").single();
    expect(data?.guia_intentada_en).toBeNull();
  });
});
