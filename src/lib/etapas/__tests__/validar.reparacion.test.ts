import { describe, expect, it } from "vitest";
import type { Modo } from "@/lib/criterios/tipos";
import type { CajaDelimitadora } from "@/lib/lugares/tipos";
import type { Dia } from "@/lib/plan/tipos";
import type { Zona } from "../clasificar";
import type { Traslado } from "../traslados";
import { alojamientoDe, asignarZona, llegadasOcupadas, nochesDeEtapa, repararEtapas, textoAjusteLlegada, validarEtapas, type ContextoEtapas, type EtapaGeo } from "../validar";

// Casos de reparación y validación con zonas y puntos fijos (sin fuentes
// grabadas): cubren los pasos que validar.test.ts no alcanza con Portugal.

const zona = (nombre: string, caja: CajaDelimitadora): Zona => ({ nombre, tipo: "country", codigo_pais: null, caja, punto: { lat: (caja.minLat + caja.maxLat) / 2, lon: (caja.minLon + caja.maxLon) / 2 } });
const PORTUGAL = zona("Portugal", { minLat: 36.9, maxLat: 42.2, minLon: -9.6, maxLon: -6.2 });
const ESPANA = zona("España", { minLat: 36, maxLat: 43.8, minLon: -6.19, maxLon: 3.3 });
const FINLANDIA = zona("Finlandia", { minLat: 59.8, maxLat: 70, minLon: 20, maxLon: 31.6 });
const ZONAS = [PORTUGAL, ESPANA, FINLANDIA];

const PUNTOS: Record<string, { lat: number; lon: number }> = {
  Lisboa: { lat: 38.72, lon: -9.14 },
  Oporto: { lat: 41.15, lon: -8.61 },
  Faro: { lat: 37.02, lon: -7.93 },
  Sevilla: { lat: 37.39, lon: -5.99 },
  Córdoba: { lat: 37.88, lon: -4.78 },
  Helsinki: { lat: 60.17, lon: 24.94 },
  Turku: { lat: 60.45, lon: 22.27 },
};

function etapa(ciudad: string, dias: number, extra: Partial<EtapaGeo> = {}): EtapaGeo {
  const punto = PUNTOS[ciudad];
  return { ciudad, pais: "", dias, alojamiento_noche_eur: 80, punto, zona: asignarZona(punto, ZONAS), ajustes: [], ...extra };
}

function ctx(diasTotales: number, extra: Partial<ContextoEtapas> = {}): ContextoEtapas {
  return { zonas: [PORTUGAL, ESPANA], modos: ["tren"] as Modo[], personas: 2, diasTotales, presupuestoEur: 100_000, actividadesEur: 0, ...extra };
}

describe("asignarZona", () => {
  it("devuelve la primera zona que contiene el punto, incluidos los bordes", () => {
    expect(asignarZona(PUNTOS.Lisboa, ZONAS)).toBe(0);
    expect(asignarZona(PUNTOS.Sevilla, ZONAS)).toBe(1);
    expect(asignarZona({ lat: 36.9, lon: -9.6 }, ZONAS)).toBe(0);
    expect(asignarZona({ lat: 0, lon: 0 }, ZONAS)).toBeNull();
    expect(asignarZona(PUNTOS.Lisboa, [])).toBeNull();
  });
});

describe("noches y alojamiento", () => {
  it("la última etapa duerme una noche menos que sus días; las demás, tantas como días", () => {
    const etapas = [{ dias: 3 }, { dias: 2 }, { dias: 4 }];
    expect([0, 1, 2].map((i) => nochesDeEtapa(etapas, i))).toEqual([3, 2, 3]);
    expect(nochesDeEtapa([{ dias: 0 }], 0)).toBe(0);
  });

  it("el alojamiento suma noches × precio por etapa", () => {
    expect(alojamientoDe([{ dias: 3, alojamiento_noche_eur: 100 }, { dias: 2, alojamiento_noche_eur: 50 }])).toBe(3 * 100 + 1 * 50);
    expect(alojamientoDe([])).toBe(0);
  });
});

describe("llegadasOcupadas", () => {
  const traslado = (duracion_min: number): Traslado => ({ modo: "avion", distancia_km: 1000, duracion_min, coste_eur: 100, procedencia: "estimado" });
  const dia = (paradas: string[]) =>
    ({ franjas: [{ id: "manana" }, { id: "tarde" }, { id: "noche" }], paradas: paradas.map((franja_id) => ({ franja_id })) }) as unknown as Pick<Dia, "franjas" | "paradas">;

  it("un traslado de más de 4 h libera también la segunda franja", () => {
    const dias = [dia([]), dia(["manana", "tarde", "noche"]), dia(["manana", "tarde"])];
    expect(llegadasOcupadas(dias, [{ dias: 1 }, { dias: 1 }, { dias: 1 }], [traslado(300), traslado(60)])).toEqual([
      { dia: 1, franja_id: "manana" },
      { dia: 1, franja_id: "tarde" },
      { dia: 2, franja_id: "manana" },
    ]);
  });

  it("un tramo desconocido cuenta como corto y un día que falta no se señala", () => {
    expect(llegadasOcupadas([dia(["manana", "tarde"])], [{ dias: 0 }, { dias: 1 }], [null])).toEqual([{ dia: 0, franja_id: "manana" }]);
    expect(llegadasOcupadas([dia(["manana"])], [{ dias: 1 }, { dias: 1 }], [traslado(60)])).toEqual([]);
  });
});

describe("validarEtapas · textos de distancia", () => {
  it("con solo tierra el texto no menciona el avión", () => {
    const textos = validarEtapas([etapa("Lisboa", 3), etapa("Helsinki", 3)], ctx(6, { zonas: [PORTUGAL, FINLANDIA] })).map((e) => e.texto);
    expect(textos).toContain("Lisboa → Helsinki: no hay forma de ir en menos de 4 h por tierra con los medios elegidos.");
  });

  it("sin medios elegidos el avión cuenta y se dice su tope", () => {
    const errores = validarEtapas([etapa("Lisboa", 3), etapa("Helsinki", 3)], ctx(6, { zonas: [PORTUGAL, FINLANDIA], modos: [] }));
    expect(errores).toContainEqual({ codigo: "distancia", texto: "Lisboa → Helsinki: no hay forma de ir en menos de 4 h por tierra ni 7 h en avión con los medios elegidos." });
  });

  it("con un tramo imposible no se calcula el presupuesto ni las llegadas", () => {
    const errores = validarEtapas([etapa("Lisboa", 3), etapa("Helsinki", 3)], ctx(6, { zonas: [PORTUGAL, FINLANDIA], presupuestoEur: 0 }), []);
    expect(errores.map((e) => e.codigo)).not.toContain("presupuesto");
  });

  it("una ciudad sin punto no genera error de distancia, solo de situación", () => {
    const errores = validarEtapas([etapa("Lisboa", 3, { punto: null, zona: null }), etapa("Sevilla", 3)], ctx(6));
    expect(errores.map((e) => e.codigo)).not.toContain("distancia");
    expect(errores.map((e) => e.texto)).toContain("No hemos podido situar Lisboa en el mapa.");
  });

  it("el singular de «día» en el mínimo por etapa", () => {
    const textos = validarEtapas([etapa("Faro", 1), etapa("Sevilla", 3)], ctx(4)).map((e) => e.texto);
    expect(textos).toContain("Faro: 1 día, el mínimo es 2.");
  });
});

describe("repararEtapas · pasos poco frecuentes", () => {
  it("trayecto imposible hacia una etapa única en su zona: se quita el origen si su zona tiene otra", () => {
    const reparadas = repararEtapas([etapa("Lisboa", 3), etapa("Oporto", 3), etapa("Helsinki", 3)], ctx(9, { zonas: [PORTUGAL, FINLANDIA] }));
    expect(reparadas.map((e) => [e.ciudad, e.dias])).toEqual([
      ["Lisboa", 6],
      ["Helsinki", 3],
    ]);
    expect(reparadas[0].ajustes).toEqual([
      "Se ha quitado Oporto (el trayecto hasta la etapa siguiente es demasiado largo con los medios elegidos) y sus 3 días pasan a Lisboa.",
    ]);
  });

  it("trayecto imposible hacia una zona con varias etapas: se quita el destino y sus días van a su vecina de zona", () => {
    const reparadas = repararEtapas([etapa("Lisboa", 3), etapa("Helsinki", 3), etapa("Turku", 3)], ctx(9, { zonas: [PORTUGAL, FINLANDIA] }));
    expect(reparadas.map((e) => [e.ciudad, e.dias])).toEqual([
      ["Lisboa", 3],
      ["Turku", 6],
    ]);
    expect(reparadas[1].ajustes[0]).toMatch(/^Se ha quitado Helsinki \(el trayecto desde la etapa anterior/);
  });

  it("si ninguna de las dos etapas del tramo imposible tiene compañera de zona, no se quita nada", () => {
    const propuestas = [etapa("Lisboa", 3), etapa("Helsinki", 3)];
    const reparadas = repararEtapas(propuestas, ctx(6, { zonas: [PORTUGAL, FINLANDIA] }));
    expect(reparadas.map((e) => [e.ciudad, e.dias, e.ajustes])).toEqual([
      ["Lisboa", 3, []],
      ["Helsinki", 3, []],
    ]);
  });

  it("una etapa de un día única en su zona gana un día de la vecina que más tiene", () => {
    const reparadas = repararEtapas([etapa("Faro", 1), etapa("Sevilla", 5)], ctx(6));
    expect(reparadas.map((e) => [e.ciudad, e.dias])).toEqual([
      ["Faro", 2],
      ["Sevilla", 4],
    ]);
    expect(reparadas[0].ajustes).toEqual(["Faro gana un día de Sevilla para llegar al mínimo de 2."]);
    expect(validarEtapas(reparadas, ctx(6))).toEqual([]);
  });

  it("si las vecinas no pueden ceder sin bajar del mínimo, la etapa corta se queda y la validación lo dice", () => {
    // Una zona por ciudad: Sevilla no se puede quitar y Faro y Córdoba, con 2
    // días, no pueden darle uno sin quedarse por debajo del mínimo.
    const SUR = zona("Sur", { minLat: 37.2, maxLat: 37.6, minLon: -6.19, maxLon: -5.8 });
    const ESTE = zona("Este", { minLat: 37.7, maxLat: 38.1, minLon: -5, maxLon: -4.5 });
    const zonas = [PORTUGAL, SUR, ESTE];
    const conZona = (ciudad: string, dias: number) => ({ ...etapa(ciudad, dias), zona: asignarZona(PUNTOS[ciudad], zonas) });
    const c = ctx(5, { zonas, modos: ["tren", "autobus", "coche"] });

    const reparadas = repararEtapas([conZona("Faro", 2), conZona("Sevilla", 1), conZona("Córdoba", 2)], c);

    expect(reparadas.map((e) => e.dias)).toEqual([2, 1, 2]);
    expect(validarEtapas(reparadas, c).map((e) => e.texto)).toContain("Sevilla: 1 día, el mínimo es 2.");
  });

  it("una ciudad sin situar que es la única etapa no se quita", () => {
    const reparadas = repararEtapas([etapa("Lisboa", 3, { punto: null, zona: null })], ctx(3));
    expect(reparadas).toHaveLength(1);
  });

  it("la suma de días nunca deja la última etapa por debajo de un día", () => {
    const reparadas = repararEtapas([etapa("Faro", 5), etapa("Sevilla", 5)], ctx(3));
    expect(reparadas.map((e) => e.dias)).toEqual([5, 1]);
    expect(reparadas[1].ajustes).toEqual(["Los días de Sevilla pasan de 5 a 1 para que las etapas cubran los 3 días del viaje."]);
  });
});

describe("textoAjusteLlegada", () => {
  it("nombra la franja y la ciudad", () => {
    expect(textoAjusteLlegada("Oporto", "mañana")).toBe("Se ha vaciado la franja mañana del día de llegada a Oporto para descansar del traslado.");
  });
});
