import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calcularPresupuesto } from "@/lib/presupuesto/calcular";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import type { Parada, Plan } from "@/lib/plan/tipos";
import { MAX_PARADA, construirModeloInfografia } from "../modelo";

const parada = (i: number, importe: number, prioridad: number): Parada => ({
  id: `p${i}`, franja_id: "manana", nombre: `Sitio ${i}`, descripcion: "x", duracion_min: 60, prioridad,
  procedencia: { fuente: "propuesto-sin-verificar" }, coste: { importe_eur: importe, por: "persona", procedencia: "estimado", fecha: "2027-06-08" },
});

const etapa = (nombre: string, dia_inicio: number, noche: number) => ({
  ciudad: { estado: "resuelta" as const, nombre, metodo: "destino" as const, caja: { minLat: 38, maxLat: 39, minLon: -10, maxLon: -9 }, intentado_en: "2027-01-01T00:00:00Z" },
  pais: "Portugal", dias: 2, dia_inicio, alojamiento_noche_eur: noche, zona: 0, ajustes: [],
});

function plan(importes: number[], personas: number, multi: boolean): Plan {
  const franjas = franjasComoArray("Portugal");
  const dias = [0, 1, 2, 3].map((d) => ({ fecha: `2027-06-${8 + d}`.replace(/-(\d)$/, "-0$1"), franjas, ...(multi ? { etapa: d < 2 ? 0 : 1 } : {}), paradas: importes.map((im, i) => parada(d * 10 + i, im, 50 + i)) }));
  return {
    id: "x", version: 1, destino: "Portugal", personas, dias,
    ...(multi ? { etapas: [etapa("Lisboa", 0, 90), etapa("Oporto", 2, 80)], traslados: [{ desde: "Lisboa", hasta: "Oporto", modo: "tren" as const, distancia_km: 313, duracion_min: 200, coste_eur: 40, procedencia: "estimado" as const }] } : {}),
  };
}

describe("construirModeloInfografia (inf-ac1, invariante 1)", () => {
  it("los totales coinciden con calcularPresupuesto para cualquier plan", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 200 }), { maxLength: 4 }), fc.integer({ min: 1, max: 8 }), fc.boolean(), fc.option(fc.integer({ min: 100, max: 9000 }), { nil: undefined }), (importes, personas, multi, tuyo) => {
        const p = plan(importes, personas, multi);
        const m = construirModeloInfografia(p, tuyo);
        expect(m.totales.total_eur).toBe(calcularPresupuesto(p).total_eur);
        expect(m.totales.dias).toBe(4);
        expect(m.totales.sitios).toBe(importes.length * 4);
        expect(m.totales.tu_presupuesto_eur).toBe(tuyo);
      }),
    );
  });

  it("multiciudad: una lámina por etapa con 2 paradas de mayor prioridad y km de traslado", () => {
    const m = construirModeloInfografia(plan([10, 10, 10], 2, true), 3000);
    expect(m.bloques.map((b) => b.titulo)).toEqual(["Lisboa", "Oporto"]);
    expect(m.bloques[0].detalle).toBe("2 noches");
    expect(m.bloques[0].paradas).toEqual(["Sitio 2", "Sitio 12"]);
    expect(m.totales.km_traslado).toBe(313);
    expect(m.totales.texto_presupuesto).toMatch(/de 3\.000\u00a0€/);
  });

  it("una ciudad: la misma lámina por días", () => {
    const m = construirModeloInfografia(plan([10, 20], 1, false));
    expect(m.multiciudad).toBe(false);
    expect(m.bloques.map((b) => b.titulo)).toEqual(["Día 1", "Día 2", "Día 3", "Día 4"]);
    expect(m.bloques[0].paradas).toEqual(["Sitio 1", "Sitio 0"]);
  });
});

function planUnaCiudad(nDias: number, destino = "Toledo", paradas: (d: number) => Parada[] = (d) => [parada(d * 10, 5, 50), parada(d * 10 + 1, 5, 40)]): Plan {
  const franjas = franjasComoArray("Portugal");
  const dias = Array.from({ length: nDias }, (_, d) => ({ fecha: new Date(Date.UTC(2027, 2, 5 + d)).toISOString().slice(0, 10), franjas, paradas: paradas(d) }));
  return { id: "x", version: 1, destino, personas: 2, dias };
}

describe("textos limpios (lam-ac1, cp-lam-01)", () => {
  const largo90 = "Concierto de música tradicional gallega con gaitas, pandeiretas y mucho más durante la noche";
  const p70 = "Monasterio de Santo Estevo de Ribas de Sil y paseo por los cañones del río";
  const plan = planUnaCiudad(1, "Escapada  de  otoño por la Ribeira Sacra con abuelos, primos y perro", () => [parada(1, 5, 90), parada(2, 5, 10)]);
  plan.dias[0].paradas[0].nombre = p70;
  plan.dias[0].paradas[1].nombre = "Torre  de Belém";
  plan.eventos = { estado: "consultado", consultado_en: "2027-01-01T00:00:00Z", eventos: [{ fecha: "2027-03-05", nombre: `${largo90}‮`, tipo: "fiesta", fuente: "wikidata", url: "https://www.wikidata.org", etapa: 0, pais: "ES" }] };
  const m = construirModeloInfografia(plan, 800);

  it("ningún texto lleva dobles espacios ni NBSP ni bidi", () => {
    for (const t of [m.titulo, m.subtitulo, ...m.bloques.flatMap((b) => [b.titulo, b.detalle, ...b.paradas]), ...m.eventos]) {
      expect(t).not.toMatch(/ {2}| |[‪-‮⁦-⁩]/);
    }
  });

  it("la parada larga termina en «…» dentro del máximo y es prefijo del original", () => {
    const [larga, corta] = m.bloques[0].paradas;
    expect(larga.endsWith("…")).toBe(true);
    expect(Array.from(new Intl.Segmenter("es", { granularity: "grapheme" }).segment(larga)).length).toBeLessThanOrEqual(MAX_PARADA);
    expect(p70.startsWith(larga.slice(0, -1))).toBe(true);
    expect(larga.slice(0, -1).endsWith(" ")).toBe(false);
    expect(corta).toBe("Torre de Belém");
  });

  it("el evento de 90 caracteres se recorta y pierde el marcador bidi", () => {
    expect(m.eventos[0].endsWith("…")).toBe(true);
    expect(m.eventos[0]).not.toMatch(/‮/);
  });

  it("el título limpia y recorta a MAX_TITULO", () => {
    expect(m.titulo).not.toMatch(/ {2}| /);
    expect(m.titulo.endsWith("…")).toBe(true);
  });
});

describe("«y N días más» (lam-ac2, cp-lam-02)", () => {
  it("10 días: 7 bloques, «y 3 días más» y totales.dias = 10", () => {
    const m = construirModeloInfografia(planUnaCiudad(10), 800);
    expect(m.bloques.map((b) => b.titulo)).toEqual(["Día 1", "Día 2", "Día 3", "Día 4", "Día 5", "Día 6", "Día 7"]);
    expect(m.resto).toBe("y 3 días más");
    expect(m.totales.dias).toBe(10);
  });

  it("7 días sin resto; 8 días en singular", () => {
    expect(construirModeloInfografia(planUnaCiudad(7), 800).resto).toBeUndefined();
    const m8 = construirModeloInfografia(planUnaCiudad(8), 800);
    expect(m8.bloques).toHaveLength(7);
    expect(m8.resto).toBe("y 1 día más");
  });

  it("multiciudad: sin resto aunque haya muchos días", () => {
    expect(construirModeloInfografia(plan([10], 2, true), 800).resto).toBeUndefined();
  });

  it("para 1 a 30 días: visibles + ocultos = total, y el resto existe si y solo si hay ocultos", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), (n) => {
        const m = construirModeloInfografia(planUnaCiudad(n));
        const ocultos = n - m.bloques.length;
        expect(m.bloques.length).toBe(Math.min(7, n));
        expect(m.totales.dias).toBe(n);
        expect(m.resto !== undefined).toBe(ocultos > 0);
        if (m.resto) expect(m.resto).toBe(`y ${ocultos} ${ocultos === 1 ? "día" : "días"} más`);
      }),
    );
  });
});
