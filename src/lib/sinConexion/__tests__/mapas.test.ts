// @vitest-environment jsdom
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { borrarMapasPlan, describirDias, diaEstaGuardado, diasGuardados, estimarMB, guardarMapasPlan, teselasDelDia } from "../mapas";
import type { PlanParaMapa, PuntoGeo } from "../mapas";
import { CACHE_MAPA } from "../reglas";
import { falsaCacheStorage } from "./cacheFalsa";

const BASE = "https://tiles.openfreemap.org";
const ESTILO = {
  sprite: `${BASE}/sprites/ofm_f384/ofm`,
  glyphs: `${BASE}/fonts/{fontstack}/{range}.pbf`,
  sources: { openmaptiles: { type: "vector", url: `${BASE}/planet` } },
  layers: [{ layout: { "text-font": ["Noto Sans Regular"] } }, { layout: { "text-font": ["Noto Sans Bold", "Noto Sans Regular"] } }, {}],
};
const TILEJSON = { tiles: [`${BASE}/planet/20261001_001001_pt/{z}/{x}/{y}.pbf`] };

const punto = fc.record({ lat: fc.double({ min: 36, max: 43, noNaN: true }), lon: fc.double({ min: -9, max: 3, noNaN: true }) });
const puntos = fc.array(punto, { minLength: 1, maxLength: 8 });
// Un día real cabe en una ciudad: si ni el zoom 10 cabe en el tope (días con
// paradas a cientos de km) se recorta y la cobertura ya no se promete.
const puntosDeCiudad = fc
  .tuple(punto, fc.array(fc.record({ dLat: fc.double({ min: 0, max: 0.2, noNaN: true }), dLon: fc.double({ min: 0, max: 0.2, noNaN: true }) }), { maxLength: 7 }))
  .map(([base, resto]) => [base, ...resto.map((r) => ({ lat: base.lat + r.dLat, lon: base.lon + r.dLon }))]);

function lonLatATesela(p: PuntoGeo, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((p.lon + 180) / 360) * n);
  const rad = (p.lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return [x, y];
}

describe("teselasDelDia (p4m-ac4, invariantes)", () => {
  it("cada punto cae dentro de las teselas de cada zoom conservado", () => {
    fc.assert(
      fc.property(puntosDeCiudad, (ps) => {
        const t = teselasDelDia(ps);
        for (const z of new Set(t.map((x) => x.z))) {
          for (const p of ps) {
            const [x, y] = lonLatATesela(p, z);
            expect(t.some((q) => q.z === z && q.x === x && q.y === y)).toBe(true);
          }
        }
      }),
    );
  });

  it("nunca pasa del tope, no repite teselas y se queda en z 10-14", () => {
    fc.assert(
      fc.property(puntos, fc.integer({ min: 1, max: 150 }), (ps, max) => {
        const t = teselasDelDia(ps, { maxTeselas: max });
        const claves = t.map((x) => `${x.z}/${x.x}/${x.y}`);
        expect(t.length).toBeLessThanOrEqual(max);
        expect(new Set(claves).size).toBe(claves.length);
        expect(t.every((x) => x.z >= 10 && x.z <= 14)).toBe(true);
      }),
    );
  });

  it("quita el zoom más alto antes que el más bajo", () => {
    const ps = [{ lat: 39.47, lon: -0.38 }, { lat: 39.5, lon: -0.3 }];
    const todas = teselasDelDia(ps, { maxTeselas: 1000 });
    const reducido = teselasDelDia(ps, { maxTeselas: todas.length - 1 });
    expect(Math.max(...reducido.map((t) => t.z))).toBeLessThan(Math.max(...todas.map((t) => t.z)));
    expect(teselasDelDia([])).toEqual([]);
  });
});

describe("textos", () => {
  it("describe los días como rangos", () => {
    expect(describirDias([1, 2, 3])).toBe("1 a 3");
    expect(describirDias([1, 3])).toBe("1 y 3");
    expect(describirDias([1, 2, 4])).toBe("1 y 2 y 4");
    expect(estimarMB(0)).toBe(1);
  });
});

const PLAN: PlanParaMapa = {
  id: "plan-1",
  dias: [
    { paradas: [{ coordenadas: { lat: 39.47, lon: -0.38 } }, { coordenadas: { lat: 39.48, lon: -0.37 } }] },
    { paradas: [{ coordenadas: { lat: 39.5, lon: -0.35 } }] },
    { paradas: [{ coordenadas: null }] },
  ],
};

function servidor(opciones: { falloEnTesela?: number; estado?: number } = {}) {
  let enVuelo = 0;
  let maximo = 0;
  let teselasPedidas = 0;
  let trasFallo = 0;
  const peticion = vi.fn(async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    enVuelo++;
    maximo = Math.max(maximo, enVuelo);
    await new Promise((r) => setTimeout(r, 1));
    enVuelo--;
    if (url === `${BASE}/styles/liberty`) return new Response(JSON.stringify(ESTILO));
    if (url === `${BASE}/planet`) return new Response(JSON.stringify(TILEJSON));
    if (url.endsWith(".pbf") && url.includes("/planet/")) {
      teselasPedidas++;
      if (opciones.falloEnTesela && teselasPedidas > opciones.falloEnTesela) {
        trasFallo++;
        return new Response("", { status: opciones.estado ?? 429 });
      }
      return new Response("tesela");
    }
    return new Response("recurso");
  });
  return { peticion: peticion as unknown as typeof fetch, maximo: () => maximo, trasFallo: () => trasFallo, teselas: () => teselasPedidas };
}

let caches_: ReturnType<typeof falsaCacheStorage>;
beforeEach(() => {
  caches_ = falsaCacheStorage();
  vi.stubGlobal("caches", caches_);
});
afterEach(() => vi.unstubAllGlobals());

describe("guardarMapasPlan (p4m-ac1, p4m-ac4, p4m-ac8)", () => {
  it("guarda estilo, TileJSON, sprite, glifos y teselas de los días con paradas, con ≤3 a la vez", async () => {
    const s = servidor();
    const progreso: number[] = [];
    const r = await guardarMapasPlan(PLAN, { peticion: s.peticion, alProgreso: (p) => progreso.push(p.dia) });
    expect(r).toEqual({ guardados: [1, 2] });
    expect(progreso).toEqual([1, 2]);
    expect(s.maximo()).toBeLessThanOrEqual(3);
    const claves = [...caches_.almacen.get(CACHE_MAPA)!.keys()];
    expect(claves).toContain(`${BASE}/styles/liberty`);
    expect(claves).toContain(`${BASE}/planet`);
    for (const f of [".json", ".png", "@2x.json", "@2x.png"]) expect(claves).toContain(`${ESTILO.sprite}${f}`);
    expect(claves.filter((c) => c.includes("/fonts/")).length).toBe(2 * 3);
    // La versión del planeta no entra en la clave.
    expect(claves.some((c) => c.includes("20261001"))).toBe(false);
    expect(await diasGuardados(PLAN)).toEqual([1, 2]);
    // Registro de la medida para el diseño: teselas y bytes estimados por día.
    console.info("mapa-medida", { teselasDia1: teselasDelDia([{ lat: 39.47, lon: -0.38 }, { lat: 39.48, lon: -0.37 }]).length, teselasPedidas: s.teselas() });
  });

  it("pulsar otra vez no vuelve a descargar lo ya guardado", async () => {
    const s = servidor();
    await guardarMapasPlan(PLAN, { peticion: s.peticion });
    const antes = (s.peticion as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const r = await guardarMapasPlan(PLAN, { peticion: s.peticion });
    expect(r.guardados).toEqual([1, 2]);
    expect((s.peticion as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(antes);
  });

  it("tras un 429 no lanza más peticiones y conserva los días completos", async () => {
    const dia1 = teselasDelDia([{ lat: 39.47, lon: -0.38 }, { lat: 39.48, lon: -0.37 }]).length;
    const s = servidor({ falloEnTesela: dia1 + 3 });
    const r = await guardarMapasPlan(PLAN, { peticion: s.peticion });
    expect(r.guardados).toEqual([1]);
    expect(r.fallo).toEqual({ dia: 2, motivo: "servidor" });
    // Como mucho las que ya volaban cuando llegó el 429.
    expect(s.trasFallo()).toBeLessThanOrEqual(3);
    expect(await diasGuardados(PLAN)).toEqual([1]);
  });

  it("un 5xx también para; cancelar con la señal deja el motivo", async () => {
    const s = servidor({ falloEnTesela: 1, estado: 503 });
    expect((await guardarMapasPlan(PLAN, { peticion: s.peticion })).fallo?.motivo).toBe("servidor");
    const control = new AbortController();
    control.abort();
    expect((await guardarMapasPlan(PLAN, { peticion: servidor().peticion, señal: control.signal })).fallo?.motivo).toBe("cancelado");
  });

  it("pide navigator.storage.persist() solo si existe y no depende de su resultado", async () => {
    const persist = vi.fn(async () => false);
    vi.stubGlobal("navigator", { ...navigator, storage: { persist } });
    const r = await guardarMapasPlan(PLAN, { peticion: servidor().peticion });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(r.guardados).toEqual([1, 2]);
    vi.stubGlobal("navigator", { ...navigator, storage: undefined });
    await expect(guardarMapasPlan(PLAN, { peticion: servidor().peticion })).resolves.toMatchObject({ guardados: [1, 2] });
  });

  it("abrir y consultar el estado nunca escribe en viajes-mapa", async () => {
    await diasGuardados(PLAN);
    await diaEstaGuardado([{ lat: 39.47, lon: -0.38 }]);
    expect(caches_.almacen.has(CACHE_MAPA)).toBe(false);
  });
});

describe("diasGuardados en vivo (p4m-ac5)", () => {
  it("un día deja de contar si falta una de sus teselas o se borra la caché", async () => {
    await guardarMapasPlan(PLAN, { peticion: servidor().peticion });
    const cache = caches_.almacen.get(CACHE_MAPA)!;
    const tesela = [...cache.keys()].find((k) => k.includes("/planet/_/"))!;
    cache.delete(tesela);
    expect((await diasGuardados(PLAN)).length).toBeLessThan(2);
    caches_.almacen.delete(CACHE_MAPA);
    expect(await diasGuardados(PLAN)).toEqual([]);
  });
});

describe("borrarMapasPlan (p4m-ac7)", () => {
  it("borra su índice y sus teselas, y respeta las que usa otro plan", async () => {
    const s = servidor();
    await guardarMapasPlan(PLAN, { peticion: s.peticion });
    await guardarMapasPlan({ ...PLAN, id: "plan-2", dias: [PLAN.dias[0]] }, { peticion: s.peticion });
    const cache = caches_.almacen.get(CACHE_MAPA)!;
    await borrarMapasPlan("plan-1");
    expect([...cache.keys()].some((k) => k.includes("/indice/plan-1"))).toBe(false);
    expect([...cache.keys()].some((k) => k.includes("/indice/plan-2"))).toBe(true);
    // El día 1 sigue completo porque plan-2 lo comparte.
    expect(await diaEstaGuardado([{ lat: 39.47, lon: -0.38 }, { lat: 39.48, lon: -0.37 }])).toBe(true);
    await borrarMapasPlan("plan-2");
    expect(await diaEstaGuardado([{ lat: 39.47, lon: -0.38 }, { lat: 39.48, lon: -0.37 }])).toBe(false);
  });

  it("no lanza sin Cache API", async () => {
    vi.stubGlobal("caches", undefined);
    await expect(borrarMapasPlan("x")).resolves.toBeUndefined();
  });
});
