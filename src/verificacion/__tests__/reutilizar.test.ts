import { describe, expect, it } from "vitest";
import { evaluarPlan, limpiezaDePlan, resolverPlan, type Dependencias, type Peticiones, type Respuesta } from "../reutilizar";

const AHORA = Date.parse("2026-10-07T12:00:00Z");
const DIA = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

function parada(rellena: boolean, comprobada = true) {
  return {
    coordenadas: { lat: 1, lon: 2 },
    procedencia: { fuente: comprobada ? "osm" : "propuesto-sin-verificar" },
    alternativas: rellena ? [{}] : [],
    curiosidades: { items: rellena ? [{}] : [] },
  };
}
const planUtil = { etapas: [{}, {}, {}], dias: [{ paradas: [parada(true), parada(true)] }] };
const planSinRelleno = { etapas: [{}, {}], dias: [{ paradas: [parada(false), parada(false)] }] };

const resp = (cuerpo: unknown, estado = 200): Respuesta => ({ ok: () => estado < 400, status: () => estado, json: async () => cuerpo });

// Servidor falso: cuenta cada petición y deja que cada ruta cambie con el tiempo.
function servidor(rutas: Record<string, () => Respuesta>) {
  const llamadas: string[] = [];
  const peticiones: Peticiones = {
    async get(ruta) {
      llamadas.push(ruta);
      return (rutas[ruta] ?? (() => resp({}, 404)))();
    },
  };
  return { peticiones, llamadas };
}

function dependencias(p: Peticiones, extra: Partial<Dependencias> = {}) {
  let reloj = AHORA;
  const creados: string[] = [];
  const guardados: string[] = [];
  const d: Dependencias = {
    peticiones: p,
    destino: "Portugal",
    diasDeAntelacion: 60,
    crearTrabajo: async () => {
      creados.push("post");
      return "trabajo-nuevo";
    },
    ahora: () => reloj,
    dormir: async (ms) => {
      reloj += ms;
    },
    esperaMaximaMs: 40 * 60_000,
    sondeoMs: 30_000,
    entorno: {},
    guardado: undefined,
    guardarTrabajo: (id) => guardados.push(id),
    ...extra,
  };
  return { d, creados, guardados };
}

const viajeReciente = (extra = {}) => ({ id: "t1", destino: "Portugal", estado: "completado", plan_id: "p1", fecha_inicio: iso(AHORA + 58 * DIA), ...extra });

describe("evaluarPlan", () => {
  it("un plan completo sirve", () => expect(evaluarPlan(planUtil).util).toBe(true));
  it("sin etapas o sin ubicar es un fallo de estructura, no de relleno", () => {
    expect(evaluarPlan({ etapas: [{}], dias: planUtil.dias })).toMatchObject({ util: false, fase: "estructura" });
    expect(evaluarPlan({ etapas: [{}, {}], dias: [{ paradas: [{ procedencia: { fuente: "osm" } }] }] })).toMatchObject({ util: false, fase: "estructura" });
  });
  it("recién completado, con 0 curiosidades y sin alternativas, es de relleno", () => {
    expect(evaluarPlan(planSinRelleno)).toMatchObject({ util: false, fase: "relleno", motivo: expect.stringContaining("aún no tiene guía y curiosidades") });
  });
  it("exige el 50 % de las comprobadas y no cuenta las sin comprobar", () => {
    const mitad = { etapas: [{}, {}], dias: [{ paradas: [parada(true), parada(false), parada(false, false)] }] };
    expect(evaluarPlan(mitad).util).toBe(true);
    const menos = { etapas: [{}, {}], dias: [{ paradas: [parada(true), parada(false), parada(false)] }] };
    expect(evaluarPlan(menos).util).toBe(false);
  });
});

describe("resolverPlan: reutiliza antes de crear", () => {
  it("con PLAN_PRUEBA_ID no crea nada ni lista viajes", async () => {
    const s = servidor({ "/api/plan/abc": () => resp(planSinRelleno) });
    const { d, creados } = dependencias(s.peticiones, { entorno: { PLAN_PRUEBA_ID: "abc" } });
    expect(await resolverPlan(d)).toEqual({ planId: "abc", creado: false });
    expect(creados).toHaveLength(0);
    expect(s.llamadas).toEqual(["/api/plan/abc"]);
  });

  it("con un plan útil del usuario hace 0 POST al formulario", async () => {
    const s = servidor({ "/api/viajes": () => resp({ viajes: [viajeReciente()] }), "/api/plan/p1": () => resp(planUtil) });
    const { d, creados } = dependencias(s.peticiones);
    expect(await resolverPlan(d)).toEqual({ planId: "p1", trabajoId: "t1", creado: false });
    expect(creados).toHaveLength(0);
  });

  it("con el id de plan.json visible y útil no mira ni la lista", async () => {
    const s = servidor({ "/api/plan/g1": () => resp(planUtil) });
    const { d, creados } = dependencias(s.peticiones, { guardado: { id: "g1" } });
    expect((await resolverPlan(d))).toMatchObject({ planId: "g1", creado: false });
    expect(creados).toHaveLength(0);
    expect(s.llamadas).toEqual(["/api/plan/g1"]);
  });

  it("ignora planes de otro destino, de más de 7 días o sin comprobar utilidad", async () => {
    const s = servidor({
      "/api/viajes": () =>
        resp({
          viajes: [
            viajeReciente({ id: "t-otro", destino: "Italia", plan_id: "p-otro" }),
            viajeReciente({ id: "t-viejo", plan_id: "p-viejo", fecha_inicio: iso(AHORA + 40 * DIA) }),
          ],
        }),
      "/api/plan/p-otro": () => resp(planUtil),
      "/api/plan/p-viejo": () => resp(planUtil),
      "/api/trabajos/trabajo-nuevo": () => resp({ estado: "completado", plan_id: "p-nuevo" }),
      "/api/plan/p-nuevo": () => resp(planUtil),
    });
    const { d, creados } = dependencias(s.peticiones);
    expect(await resolverPlan(d)).toEqual({ planId: "p-nuevo", trabajoId: "trabajo-nuevo", creado: true });
    expect(creados).toHaveLength(1);
  });

  it("con un trabajo en curso hace 0 POST y sondea ese id", async () => {
    let sondeos = 0;
    const s = servidor({
      "/api/viajes": () => resp({ viajes: [viajeReciente({ estado: "en-curso", plan_id: null })] }),
      "/api/trabajos/t1": () => resp(++sondeos < 3 ? { estado: "en-curso" } : { estado: "completado", plan_id: "p9" }),
      "/api/plan/p9": () => resp(planUtil),
    });
    const { d, creados, guardados } = dependencias(s.peticiones);
    expect(await resolverPlan(d)).toEqual({ planId: "p9", trabajoId: "t1", creado: false });
    expect(creados).toHaveLength(0);
    expect(guardados).toEqual(["t1"]);
    expect(sondeos).toBe(3);
  });

  it("con plan.json solo con trabajoId reanuda ese trabajo sin crear otro", async () => {
    const s = servidor({
      "/api/viajes": () => resp({ viajes: [] }),
      "/api/trabajos/tg": () => resp({ estado: "completado", plan_id: "pg" }),
      "/api/plan/pg": () => resp(planUtil),
    });
    const { d, creados } = dependencias(s.peticiones, { guardado: { trabajoId: "tg" } });
    expect(await resolverPlan(d)).toMatchObject({ planId: "pg", trabajoId: "tg" });
    expect(creados).toHaveLength(0);
  });

  it("un plan reciente sin relleno se espera, no se regenera", async () => {
    let lecturas = 0;
    const s = servidor({
      "/api/viajes": () => resp({ viajes: [viajeReciente()] }),
      "/api/plan/p1": () => resp(++lecturas < 4 ? planSinRelleno : planUtil),
      "/api/trabajos/t1": () => resp({ estado: "completado", plan_id: "p1" }),
    });
    const { d, creados } = dependencias(s.peticiones);
    expect(await resolverPlan(d)).toMatchObject({ planId: "p1", trabajoId: "t1" });
    expect(creados).toHaveLength(0);
  });
});

describe("resolverPlan: espera y fallos", () => {
  it("completado pero sin relleno al agotar el límite falla con su propio mensaje", async () => {
    const s = servidor({
      "/api/viajes": () => resp({ viajes: [] }),
      "/api/trabajos/trabajo-nuevo": () => resp({ estado: "completado", plan_id: "p" }),
      "/api/plan/p": () => resp(planSinRelleno),
    });
    await expect(resolverPlan(dependencias(s.peticiones).d)).rejects.toThrow("el plan aún no tiene guía y curiosidades");
  });

  it("un trabajo que nunca completa falla con el mensaje del trabajador", async () => {
    const s = servidor({ "/api/viajes": () => resp({ viajes: [] }), "/api/trabajos/trabajo-nuevo": () => resp({ estado: "en-curso" }) });
    await expect(resolverPlan(dependencias(s.peticiones).d)).rejects.toThrow("el trabajador no ha generado el plan a tiempo");
  });

  it("un plan sin etapas falla en el acto, sin esperar el límite", async () => {
    const s = servidor({
      "/api/viajes": () => resp({ viajes: [] }),
      "/api/trabajos/trabajo-nuevo": () => resp({ estado: "completado", plan_id: "p" }),
      "/api/plan/p": () => resp({ etapas: [], dias: [] }),
    });
    const { d } = dependencias(s.peticiones);
    await expect(resolverPlan(d)).rejects.toThrow("0 etapas");
  });

  it("VERIFICACION_SOLO_ENCOLAR crea el trabajo, escribe su id y sale sin sondear", async () => {
    const s = servidor({ "/api/viajes": () => resp({ viajes: [] }) });
    const { d, creados, guardados } = dependencias(s.peticiones, { entorno: { VERIFICACION_SOLO_ENCOLAR: "1" } });
    expect(await resolverPlan(d)).toEqual({ encolado: "trabajo-nuevo" });
    expect(creados).toHaveLength(1);
    expect(guardados).toEqual(["trabajo-nuevo"]);
    expect(s.llamadas.some((l) => l.startsWith("/api/trabajos/"))).toBe(false);
  });
});

describe("limpiezaDePlan", () => {
  const borrar = async () => {};
  it("sin variables no hay limpieza: el plan se conserva", () => {
    expect(limpiezaDePlan(true, {}, borrar)).toBeUndefined();
  });
  it("solo VERIFICACION_BORRAR=1 borra, y solo si el plan lo creó la suite", () => {
    expect(limpiezaDePlan(true, { VERIFICACION_BORRAR: "1" }, borrar)).toBe(borrar);
    expect(limpiezaDePlan(false, { VERIFICACION_BORRAR: "1" }, borrar)).toBeUndefined();
  });
});
