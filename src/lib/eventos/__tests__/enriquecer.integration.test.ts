import { beforeEach, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { cacheSitiosMemoria } from "@/lib/lugares/cacheSitios";
import type { CiudadEfectiva } from "@/lib/lugares/ciudad";
import type { Reloj } from "@/lib/lugares/limitador";
import { guardarPlan, recuperarPlan } from "@/lib/plan/repositorio";
import type { Plan } from "@/lib/plan/tipos";
import { enriquecerEventosDePlan } from "../enriquecer";
import { crearFuenteFestivos } from "../festivos";
import { crearFuenteWikidata } from "../wikidata";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const grabado = (n: string) => readFileSync(join(process.cwd(), "fixtures/eventos", n), "utf8");
const reloj: Reloj = { ahora: () => Date.parse("2026-10-05T12:00:00Z"), dormir: async () => undefined };
const CIUDAD: CiudadEfectiva = { estado: "resuelta", metodo: "destino", nombre: "Lisboa", caja: { minLat: 38, maxLat: 39, minLon: -9.3, maxLon: -9 }, intentado_en: "2026-10-01T00:00:00Z" };

function fuentes(peticiones: string[], estado = 200) {
  const f = (async (url: RequestInfo | URL) => {
    const u = String(url);
    peticiones.push(u);
    if (estado !== 200) return new Response("", { status: estado });
    if (u.endsWith("/Countries")) return new Response(grabado("openholidays-countries.json"));
    if (u.includes("/PublicHolidays?")) return new Response(grabado("openholidays-pt-festivos.json"));
    if (u.includes("/SchoolHolidays?")) return new Response(grabado("openholidays-pt-escolares.json"));
    if (u.includes("w/api.php")) return new Response(grabado("wikipedia-pageprops-lisboa.json"));
    if (u.includes("sparql")) return new Response(grabado("wikidata-lisboa.json"));
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const cache = cacheSitiosMemoria();
  return { festivos: crearFuenteFestivos({ fetch: f, reloj, cache }), wikidata: crearFuenteWikidata({ fetch: f, reloj, cache }) };
}

const plan = (id: string): Plan => ({
  id,
  version: 1,
  destino: "Lisboa",
  personas: 2,
  ciudad: CIUDAD,
  dias: [
    { fecha: "2027-06-09", franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }], paradas: [] },
    { fecha: "2027-06-10", franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }], paradas: [] },
    { fecha: "2027-06-13", franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }], paradas: [] },
  ],
});

async function sembrarTrabajo(supabase: ReturnType<typeof clienteDePrueba>, planId: string, modo: "fechas" | "epoca") {
  const { data: u } = await supabase.auth.admin.createUser({ email: `ci-eve-${planId}@example.com`, email_confirm: true });
  const criterios = modo === "fechas" ? { fechas: { modo: "fechas" } } : { fechas: { modo: "epoca" } };
  const { error } = await supabase.from("trabajos").insert({ usuario_id: u.user?.id, tipo: "generacion", criterios, estado: "completado", plan_id: planId });
  if (error) throw new Error(error.message);
}

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("eventos en plan_versiones (eve-ac1, eve-ac2, eve-ac4)", () => {
  const supabase = clienteDePrueba();

  beforeEach(async () => {
    await supabase.from("planes").delete().like("id", "plan-eve-%");
  });

  it("cp-eve-01: guarda los eventos de la versión y una segunda pasada no hace peticiones", async () => {
    await guardarPlan(supabase, plan("plan-eve-fechas"));
    await sembrarTrabajo(supabase, "plan-eve-fechas", "fechas");
    const peticiones: string[] = [];
    const r = await enriquecerEventosDePlan(supabase, { fuenteEventos: fuentes(peticiones), reloj }, "plan-eve-fechas");
    expect(r).toMatchObject({ intentadas: 1, con_eventos: 1, fallos: 0 });
    const guardado = await recuperarPlan(supabase, "plan-eve-fechas");
    expect(guardado?.eventos?.estado).toBe("consultado");
    expect(guardado?.eventos?.eventos.map((e) => e.nombre)).toContain("Portugal Day");
    const antes = peticiones.length;
    expect((await enriquecerEventosDePlan(supabase, { fuenteEventos: fuentes(peticiones), reloj }, "plan-eve-fechas")).intentadas).toBe(0);
    expect(peticiones.length).toBe(antes);
  });

  it("eve-ac2: un plan de época se marca sin ninguna petición", async () => {
    await guardarPlan(supabase, plan("plan-eve-epoca"));
    await sembrarTrabajo(supabase, "plan-eve-epoca", "epoca");
    const peticiones: string[] = [];
    await enriquecerEventosDePlan(supabase, { fuenteEventos: fuentes(peticiones), reloj }, "plan-eve-epoca");
    expect(peticiones).toEqual([]);
    expect((await recuperarPlan(supabase, "plan-eve-epoca"))?.eventos?.estado).toBe("epoca");
  });

  it("un 429 guarda estado fallo sin marcar el intento", async () => {
    await guardarPlan(supabase, plan("plan-eve-429"));
    await sembrarTrabajo(supabase, "plan-eve-429", "fechas");
    const r = await enriquecerEventosDePlan(supabase, { fuenteEventos: fuentes([], 429), reloj }, "plan-eve-429");
    expect(r.intentadas).toBe(0);
    const { data } = await supabase.from("plan_versiones").select("eventos_intentados_en").eq("plan_id", "plan-eve-429").single();
    expect(data?.eventos_intentados_en).toBeNull();
  });
});
