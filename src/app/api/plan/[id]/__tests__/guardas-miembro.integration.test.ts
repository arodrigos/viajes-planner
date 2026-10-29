import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { idsExternosVisitados, marcarVisitada } from "@/lib/plan/visitas";
import { recuperarPlan } from "@/lib/plan/repositorio";
import { ALOJAMIENTO_SEMILLA, invitar, limpiarPlanes, sembrarPlan } from "@/test-utils/semilla-compartir";
import { contexto, peticion, usuarioDePrueba, type UsuarioDePrueba } from "@/test-utils/sesiones";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// pin-ac3: los manejadores se descubren por glob, no a mano, así que una ruta
// nueva bajo /api/plan/[id] entra sola en la prueba y falla si no tiene guarda.
type Modulo = Record<string, unknown>;
// El glob lo resuelve Vite; el tsconfig del producto no carga sus tipos.
const RUTAS = (import.meta as unknown as { glob: (patron: string) => Record<string, () => Promise<Modulo>> }).glob("../**/{route,manejador}.{ts,tsx}");
const ESCRIBEN = ["POST", "PUT", "PATCH", "DELETE"] as const;

type Manejador = (request: ReturnType<typeof peticion>, ctx: ReturnType<typeof contexto>) => Promise<Response>;

// Cuerpos que el dueño sí aceptaría (las franjas no pueden retroceder): la guarda tiene que cortar antes de
// validarlos, no porque el cuerpo sea inválido.
const CUERPOS: Record<string, unknown> = {
  orden: { version_base: 1, dia_index: 0, orden: [{ id: "propia-0001", franja_id: "manana" }, { id: "a", franja_id: "manana" }] },
  sitios: { nombre: "Bar Nuevo" },
  visitas: { parada_id: "a" },
  ciudad: { etapa: 0, ciudad: "Cádiz" },
  miembros: { correo: "otro@example.com" },
  regenerar: {},
};

function rutaDeFichero(fichero: string, ids: Record<string, string>): { url: string; clave: string } {
  const segmentos = fichero
    .replace(/^\.\.\//, "")
    .replace(/\/?(route|manejador)\.tsx?$/, "")
    .split("/")
    .filter(Boolean);
  const url = segmentos.map((s) => ids[s] ?? s).join("/");
  const clave = segmentos.filter((s) => !s.startsWith("[")).pop() ?? "";
  return { url: `/api/plan/${ids["[id]"]}${url ? `/${url}` : ""}`, clave };
}

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("el miembro no puede escribir por ninguna ruta del plan (pin-ac3) ni leer de más (pin-ac4)", () => {
  const servicio = clienteDePrueba("servicio");
  const planId = `plan-miembro-guardas-${Date.now()}`;
  let duenyo: UsuarioDePrueba;
  let miembro: UsuarioDePrueba;
  let otroMiembro: UsuarioDePrueba;
  let ajeno: UsuarioDePrueba;
  let idMiembro: string;
  let idOtroMiembro: string;

  async function instantanea() {
    const plan = await recuperarPlan(servicio, planId);
    const { data: miembros } = await servicio.from("miembros_plan").select("id, correo").eq("plan_id", planId).order("correo");
    const { count: trabajos } = await servicio.from("trabajos").select("id", { count: "exact", head: true }).eq("plan_id", planId);
    return JSON.stringify({ plan, visitas: [...(await idsExternosVisitados(servicio, planId))].sort(), miembros, trabajos });
  }

  beforeAll(async () => {
    duenyo = await usuarioDePrueba("ci-test-comp-duenyo@example.com");
    miembro = await usuarioDePrueba("ci-test-comp-miembro@example.com");
    otroMiembro = await usuarioDePrueba("ci-test-comp-miembro2@example.com");
    ajeno = await usuarioDePrueba("ci-test-comp-ajeno@example.com");
    await sembrarPlan(servicio, planId, duenyo.usuarioId);
    idMiembro = await invitar(servicio, planId, miembro.email, duenyo.usuarioId);
    idOtroMiembro = await invitar(servicio, planId, otroMiembro.email, duenyo.usuarioId);
    await marcarVisitada(servicio, planId, "a");
  });

  afterAll(async () => {
    await limpiarPlanes(servicio, [planId]);
  });

  async function manejadoresDeEscritura() {
    const ids = { "[id]": planId, "[idExterno]": "propia-0001", "[paradaId]": "a", "[miembroId]": idOtroMiembro };
    const lista: { etiqueta: string; metodo: string; url: string; clave: string; manejador: Manejador }[] = [];
    for (const [fichero, cargar] of Object.entries(RUTAS)) {
      // Los despachadores agrupados no son endpoints: reparten a los manejadores, que ya están en el glob.
      if (fichero.includes("[...ruta]")) continue;
      const modulo = await cargar();
      for (const metodo of ESCRIBEN) {
        if (typeof modulo[metodo] !== "function") continue;
        const { url, clave } = rutaDeFichero(fichero, ids);
        lista.push({ etiqueta: `${metodo} ${url.replace(planId, "[id]")}`, metodo, url, clave, manejador: modulo[metodo] as Manejador });
      }
    }
    return lista;
  }

  it("toda escritura con la sesión del miembro responde 403 o 404 y no cambia nada", async () => {
    const antes = await instantanea();
    const lista = await manejadoresDeEscritura();
    // Si el glob dejara de encontrar rutas, el test pasaría sin probar nada.
    console.log(`Manejadores de escritura probados: ${lista.length}`);
    expect(lista.length).toBeGreaterThanOrEqual(8);

    for (const { etiqueta, metodo, url, clave, manejador } of lista) {
      const respuesta = await manejador(peticion(url, metodo, miembro.cookie, CUERPOS[clave] ?? {}), contexto({ id: planId, idExterno: "propia-0001", paradaId: "a", miembroId: idOtroMiembro }));
      expect([403, 404], etiqueta).toContain(respuesta.status);
    }
    expect(await instantanea()).toBe(antes);
  });

  it("el miembro tampoco puede invitar a otro correo ni quitar a nadie, dueño incluido", async () => {
    const lista = (await manejadoresDeEscritura()).filter((m) => m.clave === "miembros");
    expect(lista.length).toBeGreaterThanOrEqual(2);
    for (const { etiqueta, metodo, url, manejador } of lista) {
      const cuerpo = metodo === "POST" ? { correo: "otro@example.com" } : undefined;
      const respuesta = await manejador(peticion(url.replace(idOtroMiembro, idMiembro), metodo, miembro.cookie, cuerpo), contexto({ id: planId, miembroId: idMiembro }));
      expect([403, 404], etiqueta).toContain(respuesta.status);
    }
    const { data } = await servicio.from("miembros_plan").select("correo").eq("plan_id", planId);
    expect(data?.map((f) => f.correo).sort()).toEqual([miembro.email, otroMiembro.email].sort());
  });

  it("un usuario sin relación con el plan recibe 404 en todas", async () => {
    const lista = await manejadoresDeEscritura();
    for (const { etiqueta, metodo, url, clave, manejador } of lista) {
      const respuesta = await manejador(peticion(url, metodo, ajeno.cookie, CUERPOS[clave] ?? {}), contexto({ id: planId, idExterno: "propia-0001", paradaId: "a", miembroId: idOtroMiembro }));
      expect(respuesta.status, etiqueta).toBe(404);
    }
  });

  it("la guarda no rompe al dueño: la misma llamada a orden le responde 200", async () => {
    const lista = await manejadoresDeEscritura();
    const orden = lista.find((m) => m.clave === "orden");
    expect(orden).toBeDefined();
    const respuesta = await orden!.manejador(peticion(orden!.url, "POST", duenyo.cookie, CUERPOS.orden), contexto({ id: planId }));
    expect(respuesta.status).toBe(200);
  });

  it("miembros no devuelve al miembro los correos de otros", async () => {
    const { GET } = (await RUTAS["../miembros/manejador.ts"]()) as unknown as { GET: Manejador };
    const respuesta = await GET(peticion(`/api/plan/${planId}/miembros`, "GET", miembro.cookie), contexto({ id: planId }));
    expect([403, 404]).toContain(respuesta.status);
    expect(await respuesta.text()).not.toContain(otroMiembro.email);
  });

  it("el .ics y la lámina del miembro no filtran presupuesto, alojamiento ni su ubicación", async () => {
    const { GET: calendario } = (await RUTAS["../calendario.ics/manejador.ts"]()) as unknown as { GET: Manejador };
    const r = await calendario(peticion(`/api/plan/${planId}/calendario.ics`, "GET", miembro.cookie), contexto({ id: planId }));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/calendar");
    // UID y DTSTAMP son aleatorios o de reloj y pueden contener «140» u «85» por azar.
    const ics = (await r.text()).replace(/^(UID|DTSTAMP)[:;].*$/gm, "");
    expect(ics).not.toMatch(/€|presupuesto|alojamiento|4000|140|85/i);
    expect(ics).not.toContain(ALOJAMIENTO_SEMILLA);

    const { GET: infografia } = (await RUTAS["../infografia.png/route.tsx"]()) as unknown as { GET: Manejador };
    const lamina = await infografia(peticion(`/api/plan/${planId}/infografia.png`, "GET", miembro.cookie), contexto({ id: planId }));
    expect(lamina.status).toBe(200);
    expect(lamina.headers.get("content-type")).toBe("image/png");
  });
});
