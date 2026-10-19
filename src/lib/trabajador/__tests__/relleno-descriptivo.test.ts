import { describe, expect, it } from "vitest";
import { cacheSitiosMemoria } from "@/lib/lugares/cacheSitios";
import { PETICIONES_MAXIMAS_POR_PLAN, VERSION_RESOLUTOR_ACTUAL } from "@/lib/lugares/ciudad";
import { crearFuenteAbierta } from "@/lib/lugares/fuenteAbierta";
import type { Reloj } from "@/lib/lugares/limitador";
import { completarParadasPendientes } from "@/lib/trabajador/barrido";
import { PRESUPUESTO_PETICIONES_POR_TICK } from "@/lib/trabajador/presupuestoTick";
import { crearBaseEnMemoria, type Fila } from "./__fixtures__/baseEnMemoria";

// rel-ac2: regresión del 0 de 467. Un destino descriptivo («Ciudad con
// niños») que Nominatim resuelve a un punto sin área. Con el código anterior
// el tope de 12 peticiones del plan se gastaba en esa caja y en «Ciudad» /
// «Ciudad con» y la ciudad no se deducía por las paradas ni en el primer tick.
// Nominatim es un fetch falso con la forma real de la API; los sitios son
// monumentos públicos famosos, no datos de ningún plan real.

type Caja4 = [string, string, string, string];
const CAJA_SEVILLA: Caja4 = ["37.30", "37.45", "-6.05", "-5.85"];
// Un asentamiento cualquiera que se llama «Ciudad»: caja válida, lejos de Sevilla.
const CAJA_ASENTAMIENTO_HOMONIMO: Caja4 = ["40.00", "40.10", "-3.00", "-2.90"];
const PUNTO_SIN_AREA: Caja4 = ["10.5", "10.5", "20.5", "20.5"];

const SITIOS = [
  "Real Alcázar",
  "Catedral de Sevilla",
  "Giralda",
  "Plaza de España",
  "Torre del Oro",
  "Parque de María Luisa",
  "Metropol Parasol",
  "Barrio de Santa Cruz",
];
const FRASES = ["Tarde libre en familia por el centro de la ciudad", "Paseo tranquilo con los niños y helado"];

function relojFalso(): Reloj {
  const estado = { t: 0 };
  return { ahora: () => estado.t, dormir: async (ms: number) => void (estado.t += ms) };
}

function entrada(nombre: string, ciudad: string, caja: Caja4) {
  return {
    osm_type: "way",
    osm_id: 7,
    lat: String((Number(caja[0]) + Number(caja[1])) / 2),
    lon: String((Number(caja[2]) + Number(caja[3])) / 2),
    category: "tourism",
    type: "attraction",
    display_name: `${nombre}, ${ciudad}`,
    boundingbox: caja,
    namedetails: { name: nombre },
    extratags: {},
    address: { city: ciudad },
  };
}

function montar(destino: string, cache = cacheSitiosMemoria()) {
  const reloj = relojFalso();
  const peticiones: URL[] = [];
  const fetchFalso = async (entradaUrl: string): Promise<Response> => {
    const url = new URL(entradaUrl);
    peticiones.push(url);
    const q = url.searchParams.get("q") ?? "";
    const responder = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: 200 });
    if (!url.hostname.includes("nominatim")) return responder({ query: { search: [] } });

    if (url.searchParams.get("featureType") === "settlement") {
      if (q === "Sevilla") return responder([{ ...entrada(q, q, CAJA_SEVILLA), boundingbox: CAJA_SEVILLA }]);
      if (q === "Ciudad" || q === "Ciudad con") {
        return responder([{ ...entrada(q, q, CAJA_ASENTAMIENTO_HOMONIMO), boundingbox: CAJA_ASENTAMIENTO_HOMONIMO }]);
      }
      return responder([]);
    }
    if (url.searchParams.get("bounded") === "1") {
      const [minLon, maxLat] = (url.searchParams.get("viewbox") ?? "").split(",").map(Number);
      const nombre = q.split(",")[0].trim();
      const enSevilla = minLon >= -6.05 && maxLat <= 37.45 && SITIOS.includes(nombre);
      return responder(enSevilla ? [entrada(nombre, "Sevilla", CAJA_SEVILLA)] : []);
    }
    if (url.searchParams.get("addressdetails") === "1") {
      return responder(SITIOS.includes(q) ? [entrada(q, "Sevilla", CAJA_SEVILLA)] : []);
    }
    // Geocodificación del destino entero.
    return responder(q === destino ? [{ ...entrada(q, q, PUNTO_SIN_AREA), boundingbox: PUNTO_SIN_AREA }] : []);
  };
  const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache });
  return { fuente, peticiones, reloj };
}

function planCon(destino: string, nombres: string[]) {
  const parada = (nombre: string, i: number): Fila => ({
    id: `p${i}`,
    nombre,
    categoria: "monumento",
    dia_index: 0,
    plan_version_id: "v1",
    resolucion: null,
    lat: null,
    lon: null,
    lugar: null,
    duracion_min: 60,
    alternativas_intentadas_en: null,
    foto: null,
    foto_intentada_en: null,
  });
  return crearBaseEnMemoria({
    planes: [{ id: "plan", destino, ciudad: null }],
    plan_versiones: [{ id: "v1", plan_id: "plan", version: 1, dias: [{ fecha: "2026-11-01" }], etapas: null }],
    paradas: nombres.map(parada),
    paradas_alternativas: [],
  });
}

async function tick(base: ReturnType<typeof planCon>, fuente: ReturnType<typeof montar>["fuente"], reloj: Reloj) {
  return completarParadasPendientes(base.cliente as never, fuente, 120, undefined, reloj, 180_000, undefined, new Date("2026-10-05T18:00:00Z"));
}

describe("relleno de un destino descriptivo (rel-ac2)", () => {
  it("«Ciudad con niños» con 8 sitios y 2 frases: ciudad por paradas en el primer tick y ubicadas en dos", async () => {
    const destino = "Ciudad con niños";
    const base = planCon(destino, [...SITIOS, ...FRASES]);
    const cache = cacheSitiosMemoria();

    const uno = montar(destino, cache);
    const r1 = await tick(base, uno.fuente, uno.reloj);
    const ciudad = base.tablas.planes[0].ciudad as Record<string, unknown> | null;
    expect(ciudad?.estado).toBe("resuelta");
    expect(ciudad?.metodo).toBe("paradas");
    expect(ciudad?.nombre).toBe("Sevilla");
    expect(ciudad?.version_resolutor).toBe(VERSION_RESOLUTOR_ACTUAL);
    expect(r1.peticionesNominatimCiudad).toBeLessThanOrEqual(PETICIONES_MAXIMAS_POR_PLAN);
    expect(uno.peticiones.length).toBeLessThanOrEqual(PRESUPUESTO_PETICIONES_POR_TICK);

    const dos = montar(destino, cache);
    await tick(base, dos.fuente, dos.reloj);
    const estado = (n: string) => (base.tablas.paradas.find((p) => p.nombre === n)?.resolucion as { estado?: string } | null)?.estado;
    expect(SITIOS.filter((s) => estado(s) === "resuelta").length).toBeGreaterThanOrEqual(6);
    for (const frase of FRASES) expect(estado(frase)).toBe("no-resuelta");
    expect(dos.peticiones.length).toBeLessThanOrEqual(PRESUPUESTO_PETICIONES_POR_TICK);
  });

  it("control: «Londres en familia con niños» se resuelve en el primer tick por el candidato de texto", async () => {
    const destino = "Londres en familia con niños";
    const base = planCon(destino, SITIOS);
    const reloj = relojFalso();
    const peticiones: URL[] = [];
    const caja: Caja4 = ["51.28", "51.69", "-0.51", "0.33"];
    const fetchFalso = async (u: string) => {
      const url = new URL(u);
      peticiones.push(url);
      const q = url.searchParams.get("q") ?? "";
      const cuerpo =
        url.searchParams.get("featureType") === "settlement" && q === "Londres"
          ? [{ ...entrada(q, q, caja), boundingbox: caja }]
          : url.searchParams.get("bounded") === "1"
            ? [entrada(q.split(",")[0].trim(), "London", caja)]
            : [];
      return new Response(JSON.stringify(cuerpo), { status: 200 });
    };
    const fuente = crearFuenteAbierta({ fetch: fetchFalso as unknown as typeof fetch, reloj, cache: cacheSitiosMemoria() });
    await tick(base, fuente, reloj);
    const ciudad = base.tablas.planes[0].ciudad as Record<string, unknown> | null;
    expect(ciudad?.estado).toBe("resuelta");
    expect(ciudad?.nombre).toBe("Londres");
  });

  it("«Ciudad con niños» con solo 2 paradas se sella como «sin-ciudad-identificable» por pocas paradas, nunca null", async () => {
    const destino = "Ciudad con niños";
    const base = planCon(destino, SITIOS.slice(0, 2));
    const { fuente, reloj } = montar(destino);
    await tick(base, fuente, reloj);
    const ciudad = base.tablas.planes[0].ciudad as Record<string, unknown> | null;
    expect(ciudad?.estado).toBe("sin-ciudad-identificable");
    expect(ciudad?.categoria_motivo).toBe("pocas-paradas");
  });
});
