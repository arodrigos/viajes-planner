import { describe, expect, it } from "vitest";
import type { CajaDelimitadora, FuenteCiudad } from "@/lib/lugares/tipos";
import type { Plan } from "@/lib/plan/tipos";
import type { Zona } from "../clasificar";
import { PISO_ALOJAMIENTO_EUR } from "../constantes";
import { cerrarEtapas, contextoDe, erroresDeDias, erroresParaReintento, extraerEtapasPropuestas, situarEtapas, validarPropuesta, type EtapaSituada } from "../multiciudad";
import { MAX_ETAPAS } from "../reglas";

// Casos límite de multiciudad.ts con zonas y puntos fijos: nada se
// geocodifica de verdad (la fuente de ciudades es un doble en memoria).

const zona = (nombre: string, caja: CajaDelimitadora): Zona => ({
  nombre,
  tipo: "country",
  codigo_pais: null,
  caja,
  punto: { lat: (caja.minLat + caja.maxLat) / 2, lon: (caja.minLon + caja.maxLon) / 2 },
});
const PORTUGAL = zona("Portugal", { minLat: 36.9, maxLat: 42.2, minLon: -9.6, maxLon: -6.2 });
const ESPANA = zona("España", { minLat: 36, maxLat: 43.8, minLon: -6.19, maxLon: 3.3 });

const cajaDe = (lat: number, lon: number, medio = 0.1): CajaDelimitadora => ({ minLat: lat - medio, maxLat: lat + medio, minLon: lon - medio, maxLon: lon + medio });

describe("extraerEtapasPropuestas", () => {
  it("sin lista de etapas devuelve una lista vacía", () => {
    expect(extraerEtapasPropuestas(null, 2)).toEqual([]);
    expect(extraerEtapasPropuestas({}, 2)).toEqual([]);
    expect(extraerEtapasPropuestas({ etapas: "Lisboa" }, 2)).toEqual([]);
  });

  it("copia solo los campos válidos y conserva el motivo", () => {
    const etapas = extraerEtapasPropuestas({ etapas: [{ ciudad: "  Lisboa ", pais: "Portugal", dias: 3, alojamiento_noche_eur: 120, motivo: " Capital ", extra: "x" }] }, 2);
    expect(etapas).toEqual([{ ciudad: "Lisboa", pais: "Portugal", dias: 3, motivo: "Capital", alojamiento_noche_eur: 120, punto: null, zona: null, ajustes: [] }]);
  });

  it("descarta ciudades vacías, demasiado largas, con URL o marcado, y días fuera de 1..60 o no enteros", () => {
    const etapas = extraerEtapasPropuestas(
      {
        etapas: [
          { ciudad: "x".repeat(80), dias: 60, alojamiento_noche_eur: 0 },
          null,
          { ciudad: "", dias: 2 },
          { ciudad: "x".repeat(81), dias: 2 },
          { ciudad: "https://malo.example", dias: 2 },
          { ciudad: "javascript:alert(1)", dias: 2 },
          { ciudad: "<b>Oporto</b>", dias: 2 },
          { ciudad: "Oporto", dias: 0 },
          { ciudad: "Oporto", dias: 61 },
          { ciudad: "Oporto", dias: 2.5 },
          { ciudad: "Oporto", dias: "2" },
          { ciudad: 42, dias: 2 },
        ],
      },
      1,
    );
    expect(etapas.map((e) => [e.ciudad.length, e.dias])).toEqual([[80, 60]]);
  });

  it("los caracteres de control se vuelven espacios y un país no válido queda vacío", () => {
    const [e] = extraerEtapasPropuestas({ etapas: [{ ciudad: "San\u0000Sebastián", pais: "<script>", dias: 2, alojamiento_noche_eur: 50 }] }, 2);
    expect(e.ciudad).toBe("San Sebastián");
    expect(e.pais).toBe("");
  });

  it("un alojamiento ausente, negativo, no finito o absurdo usa el piso por persona y lo dice", () => {
    const etapas = extraerEtapasPropuestas(
      {
        etapas: [
          { ciudad: "A", dias: 2 },
          { ciudad: "B", dias: 2, alojamiento_noche_eur: -1 },
          { ciudad: "C", dias: 2, alojamiento_noche_eur: Number.POSITIVE_INFINITY },
          { ciudad: "D", dias: 2, alojamiento_noche_eur: 5001 },
          { ciudad: "E", dias: 2, alojamiento_noche_eur: 5000 },
        ],
      },
      3,
    );
    expect(etapas.map((e) => e.alojamiento_noche_eur)).toEqual([PISO_ALOJAMIENTO_EUR * 3, PISO_ALOJAMIENTO_EUR * 3, PISO_ALOJAMIENTO_EUR * 3, PISO_ALOJAMIENTO_EUR * 3, 5000]);
    expect(etapas[0].ajustes).toEqual([`A: sin precio de alojamiento válido, se usa el mínimo de ${PISO_ALOJAMIENTO_EUR} € por persona y noche.`]);
    expect(etapas[4].ajustes).toEqual([]);
  });

  it(`no mira más allá de ${MAX_ETAPAS + 4} etapas propuestas`, () => {
    const crudas = Array.from({ length: MAX_ETAPAS + 10 }, (_, i) => ({ ciudad: `C${i}`, dias: 2, alojamiento_noche_eur: 50 }));
    expect(extraerEtapasPropuestas({ etapas: crudas }, 2)).toHaveLength(MAX_ETAPAS + 4);
  });
});

describe("situarEtapas", () => {
  function fuente(cajas: Record<string, CajaDelimitadora | null | Error>) {
    const consultas: string[] = [];
    const f = {
      buscarLibre: async () => [],
      async geocodificarCiudad(nombre: string) {
        consultas.push(nombre);
        const c = cajas[nombre];
        if (c instanceof Error) throw c;
        return c ?? null;
      },
    } as unknown as FuenteCiudad;
    return { f, consultas };
  }
  const propuesta = (ciudad: string, pais = "") => ({ ciudad, pais, dias: 2, alojamiento_noche_eur: 50, punto: null, zona: null, ajustes: [] });

  it("sitúa por el centro de la caja y asigna la zona que lo contiene", async () => {
    const { f, consultas } = fuente({ "Lisboa, Portugal": cajaDe(38.72, -9.14), Sevilla: cajaDe(37.39, -5.99) });
    const [lisboa, sevilla] = await situarEtapas(f, [propuesta("Lisboa", "Portugal"), propuesta("Sevilla")], [PORTUGAL, ESPANA]);

    expect(consultas).toEqual(["Lisboa, Portugal", "Sevilla"]);
    expect(lisboa.punto?.lat).toBeCloseTo(38.72);
    expect(lisboa.punto?.lon).toBeCloseTo(-9.14);
    expect(lisboa.zona).toBe(0);
    expect(sevilla.zona).toBe(1);
    expect(sevilla.caja).toEqual(cajaDe(37.39, -5.99));
  });

  it("una ciudad que no geocodifica, que lanza o de más de 2 grados queda sin punto ni zona", async () => {
    const { f } = fuente({ Nada: null, Rota: new Error("red"), Enorme: cajaDe(40, -4, 1.5) });
    const situadas = await situarEtapas(f, [propuesta("Nada"), propuesta("Rota"), propuesta("Enorme")], [ESPANA]);
    expect(situadas.map((e) => [e.caja, e.punto, e.zona])).toEqual([
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ]);
  });

  it("una ciudad situada fuera de todas las zonas tiene punto pero no zona", async () => {
    const { f } = fuente({ Roma: cajaDe(41.9, 12.5) });
    const [roma] = await situarEtapas(f, [propuesta("Roma")], [PORTUGAL, ESPANA]);
    expect(roma.punto).not.toBeNull();
    expect(roma.zona).toBeNull();
  });
});

describe("erroresDeDias", () => {
  it("acepta días sin etapa o con etapa creciente", () => {
    expect(erroresDeDias(null)).toEqual([]);
    expect(erroresDeDias({ dias: "no" })).toEqual([]);
    expect(erroresDeDias({ dias: [{ etapa: 0 }, { etapa: 0 }, {}, null, { etapa: "1" }, { etapa: 1 }] })).toEqual([]);
  });

  it("una etapa que baja rompe la contigüidad", () => {
    const errores = erroresDeDias({ dias: [{ etapa: 0 }, { etapa: 1 }, { etapa: 0 }] });
    expect(errores).toHaveLength(1);
    expect(errores[0].codigo).toBe("dias");
  });
});

describe("erroresParaReintento", () => {
  it("cada error se convierte en un mensaje sobre la ruta etapas", () => {
    expect(erroresParaReintento([{ codigo: "dias", texto: "uno" }, { codigo: "presupuesto", texto: "dos" }])).toEqual([
      { ruta: "etapas", mensaje: "uno" },
      { ruta: "etapas", mensaje: "dos" },
    ]);
    expect(erroresParaReintento([])).toEqual([]);
  });
});

function plan(dias: number, personas = 2, costePorPersona = 10): Plan {
  return {
    personas,
    dias: Array.from({ length: dias }, (_, i) => ({
      fecha: `2026-11-${String(1 + i).padStart(2, "0")}`,
      franjas: [{ id: "manana", etiqueta: "Mañana" }, { id: "tarde", etiqueta: "Tarde" }],
      paradas: [{ nombre: `Parada ${i}`, franja_id: "tarde", coste: { importe_eur: costePorPersona, por: "persona", procedencia: "estimado" } }],
    })),
  } as unknown as Plan;
}

function situada(ciudad: string, lat: number, lon: number, dias: number, zonaIdx: number | null, noche = 80, caja: CajaDelimitadora | null = cajaDe(lat, lon)): EtapaSituada {
  return { ciudad, pais: "", dias, alojamiento_noche_eur: noche, punto: { lat, lon }, zona: zonaIdx, ajustes: [], caja };
}

describe("contextoDe y validarPropuesta", () => {
  it("el contexto toma días y personas del plan y suma las visitas", () => {
    const ctx = contextoDe(plan(4, 3, 10), [PORTUGAL], ["tren"], 1000);
    expect(ctx).toEqual({ zonas: [PORTUGAL], modos: ["tren"], personas: 3, diasTotales: 4, presupuestoEur: 1000, actividadesEur: 120 });
  });

  it("validarPropuesta usa los días del plan para comprobar la suma", () => {
    const errores = validarPropuesta([situada("Lisboa", 38.72, -9.14, 3, 0)], { zonas: [PORTUGAL], modos: ["tren"], personas: 2, presupuestoEur: 10_000 }, plan(5));
    expect(errores.map((e) => e.texto)).toContain("Las etapas suman 3 días y el viaje tiene 5.");
  });
});

describe("cerrarEtapas · casos límite", () => {
  it("una ciudad sin caja queda como «sin ciudad identificable» en su etapa", () => {
    const r = cerrarEtapas(plan(4), [situada("Faro", 37.02, -7.93, 2, 0, 80, null), situada("Sevilla", 37.39, -5.99, 2, 1)], {
      zonas: [PORTUGAL, ESPANA],
      modos: ["tren", "autobus"],
      personas: 2,
      presupuestoEur: 10_000,
    });
    expect(r.inviable).toBe(false);
    if (r.inviable) return;
    expect(r.plan.etapas?.map((e) => e.ciudad.estado)).toEqual(["sin-ciudad-identificable", "resuelta"]);
    expect(r.plan.etapas?.map((e) => e.dia_inicio)).toEqual([0, 2]);
    expect(r.plan.traslados?.map((t) => [t.desde, t.hasta])).toEqual([["Faro", "Sevilla"]]);
  });

  it("sin presupuesto el descarte trae las razones sin repetir y la sugerencia de presupuesto", () => {
    const r = cerrarEtapas(plan(4), [situada("Faro", 37.02, -7.93, 2, 0), situada("Sevilla", 37.39, -5.99, 2, 1)], {
      zonas: [PORTUGAL, ESPANA],
      modos: ["tren"],
      personas: 2,
      presupuestoEur: 10,
    });
    expect(r.inviable).toBe(true);
    if (!r.inviable) return;
    expect(r.descarte.razones.map((x) => x.codigo)).toEqual(["presupuesto"]);
    expect(r.descarte.sugerencias).toEqual(["Sube el presupuesto o reduce los días, las personas o las ciudades."]);
  });

  it("una zona sin etapa y un trayecto imposible dan sus sugerencias", () => {
    const LEJOS = zona("Finlandia", { minLat: 59.8, maxLat: 70, minLon: 20, maxLon: 31.6 });
    const r = cerrarEtapas(plan(6), [situada("Lisboa", 38.72, -9.14, 3, 0), situada("Helsinki", 60.17, 24.94, 3, 2)], {
      zonas: [PORTUGAL, ESPANA, LEJOS],
      modos: ["tren"],
      personas: 2,
      presupuestoEur: 100_000,
    });
    expect(r.inviable).toBe(true);
    if (!r.inviable) return;
    const codigos = r.descarte.razones.map((x) => x.codigo);
    expect(codigos).toContain("zona-sin-etapa");
    expect(codigos).toContain("distancia");
    expect(r.descarte.sugerencias).toEqual(["Marca «Avión» o elige zonas más cercanas.", "Prueba con menos zonas o con más días."]);
    // Cada texto aparece una sola vez.
    const textos = r.descarte.razones.map((x) => x.texto);
    expect(new Set(textos).size).toBe(textos.length);
  });
});
