import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { aPlanCompartido } from "@/lib/plan/compartido";
import { aPlanPublico } from "@/lib/plan/publico";
import type { AnclaAlojamiento, CosteParada, Parada, Plan } from "@/lib/plan/tipos";

const FRANJAS = [
  { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" },
  { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:00", hora_fin: "20:00" },
];

const importe = fc.integer({ min: 0, max: 5000 });
const coste: fc.Arbitrary<CosteParada> = fc.record({
  importe_eur: importe,
  por: fc.constantFrom("persona" as const, "grupo" as const),
  procedencia: fc.constantFrom("estimado" as const, "wikivoyage" as const),
  fecha: fc.constant("2026-10-01"),
});
const ancla: fc.Arbitrary<AnclaAlojamiento> = fc.oneof(
  fc.record({ tipo: fc.constant("zona-propuesta" as const), centroide: fc.record({ lat: fc.double({ min: 37, max: 38, noNaN: true }), lon: fc.double({ min: -6, max: -5, noNaN: true }) }), radio_m: fc.integer({ min: 100, max: 2000 }) }),
  fc.record({ tipo: fc.constant("usuario" as const), direccion: fc.string({ minLength: 1, maxLength: 30 }) }),
);

const parada = (i: number) =>
  fc
    .record({
      nota: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
      coste: fc.option(coste, { nil: undefined }),
      coordenadas: fc.option(fc.record({ lat: fc.double({ min: 37, max: 38, noNaN: true }), lon: fc.double({ min: -6, max: -5, noNaN: true }) }), { nil: undefined }),
      franja: fc.constantFrom("manana", "tarde"),
    })
    .map(({ nota, coste, coordenadas, franja }): Parada => ({
      id: `p${i}`,
      franja_id: franja,
      nombre: `Sitio ${i}`,
      descripcion: "Descripción",
      duracion_min: 60,
      prioridad: 50,
      procedencia: { fuente: "propuesto-sin-verificar" },
      ...(nota !== undefined ? { nota } : {}),
      ...(coste ? { coste } : {}),
      ...(coordenadas ? { coordenadas } : {}),
    }));

const dia = (d: number) =>
  fc.record({ paradas: fc.tuple(...[0, 1, 2].map((i) => parada(d * 10 + i))).chain((todas) => fc.integer({ min: 0, max: 3 }).map((n) => todas.slice(0, n))), ancla: fc.option(ancla, { nil: undefined }) }).map(({ paradas, ancla }) => ({
    fecha: `2026-11-0${d + 1}`,
    ...(ancla ? { ancla_alojamiento: ancla } : {}),
    franjas: FRANJAS,
    paradas,
  }));

const plan: fc.Arbitrary<{ plan: Plan; presupuesto: number }> = fc
  .record({
    dias: fc.tuple(dia(0), dia(1), dia(2)).chain((todos) => fc.integer({ min: 1, max: 3 }).map((n) => todos.slice(0, n))),
    noche: importe,
    trasladoEur: importe,
    multiciudad: fc.boolean(),
    presupuesto: importe,
  })
  .map(({ dias, noche, trasladoEur, multiciudad, presupuesto }) => ({
    presupuesto,
    plan: {
      id: "p",
      version: 1,
      destino: "Sevilla",
      personas: 2,
      dias,
      ...(multiciudad
        ? {
            etapas: [{ ciudad: { estado: "resuelta" as const, nombre: "Sevilla", intentado_en: "2026-10-01T00:00:00Z" }, pais: "ES", dias: dias.length, dia_inicio: 0, alojamiento_noche_eur: noche, zona: 0, ajustes: [] }],
            traslados: [{ desde: "A", hasta: "B", modo: "tren" as const, distancia_km: 100, duracion_min: 60, coste_eur: trasladoEur, procedencia: "estimado" as const }],
          }
        : {}),
    } satisfies Plan,
  }));

const CLAVES_PROHIBIDAS = ["presupuesto", "tu_presupuesto_eur", "alojamiento_noche_eur", "ancla_alojamiento", "trabajoId", "regenerando", "google", "coste_eur"];

// Lo que la ruta del dueño añade tras aPlanPublico y que la proyección debe tirar aunque llegue.
function conExtrasDelDuenyo(p: ReturnType<typeof aPlanPublico>) {
  return { ...p, trabajoId: "t", regenerando: true, dias: p.dias.map((d) => ({ ...d, paradas: d.paradas.map((x) => ({ ...x, google: { estado: "casado" as const } })) })) };
}

describe("aPlanCompartido (cmd-ac3)", () => {
  it("invariante: nunca contiene las claves de dinero, alojamiento, trabajo ni Google", () => {
    fc.assert(
      fc.property(plan, ({ plan: p, presupuesto }) => {
        const json = JSON.stringify(aPlanCompartido(conExtrasDelDuenyo(aPlanPublico(p, "familiar", presupuesto))));
        for (const clave of CLAVES_PROHIBIDAS) expect(json).not.toContain(`"${clave}"`);
      }),
      { numRuns: 100 },
    );
  });

  it("invariante: conserva días, paradas, ids, nombres, notas, precio, coordenadas y horarios", () => {
    fc.assert(
      fc.property(plan, ({ plan: p, presupuesto }) => {
        const dueno = aPlanPublico(p, "familiar", presupuesto);
        const miembro = aPlanCompartido(dueno);
        expect(miembro.dias.length).toBe(dueno.dias.length);
        miembro.dias.forEach((d, i) => {
          expect(d.fecha).toBe(dueno.dias[i].fecha);
          expect(d.paradas.map((x) => x.id)).toEqual(dueno.dias[i].paradas.map((x) => x.id));
          d.paradas.forEach((x, j) => {
            const original = dueno.dias[i].paradas[j];
            expect({ nombre: x.nombre, nota: x.nota, coste: x.coste, coordenadas: x.coordenadas, horario: x.horario }).toEqual({ nombre: original.nombre, nota: original.nota, coste: original.coste, coordenadas: original.coordenadas, horario: original.horario });
          });
        });
        expect(miembro.compartido).toEqual({ rol: "miembro" });
      }),
      { numRuns: 100 },
    );
  });

  it("no muta el plan del dueño", () => {
    const { plan: p } = fc.sample(plan, 1)[0];
    const dueno = aPlanPublico(p, "familiar", 4000);
    const antes = JSON.stringify(dueno);
    aPlanCompartido(dueno);
    expect(JSON.stringify(dueno)).toBe(antes);
    expect(dueno.presupuesto.tu_presupuesto_eur).toBe(4000);
  });
});

// pin-ac1: la proyección tiene que fallar si deja de quitar cualquiera de las
// claves, una a una. Estos generadores llevan SIEMPRE etapas con alojamiento y
// traslados con coste, que en el generador general solo salen si multiciudad.
const planMulticiudad = plan.map(({ plan: p, presupuesto }) => ({
  presupuesto,
  plan: {
    ...p,
    etapas: [
      { ciudad: { estado: "resuelta" as const, nombre: "Sevilla", intentado_en: "2026-10-01T00:00:00Z" }, pais: "ES", dias: 1, dia_inicio: 0, alojamiento_noche_eur: 90, zona: 0, ajustes: [] },
      { ciudad: { estado: "resuelta" as const, nombre: "Cádiz", intentado_en: "2026-10-01T00:00:00Z" }, pais: "ES", dias: 1, dia_inicio: 1, alojamiento_noche_eur: 110, zona: 0, ajustes: [] },
    ],
    traslados: [{ desde: "Sevilla", hasta: "Cádiz", modo: "tren" as const, distancia_km: 125, duracion_min: 90, coste_eur: 35, procedencia: "estimado" as const }],
  } satisfies Plan,
}));

const TODAS_LAS_CLAVES = [...CLAVES_PROHIBIDAS, "compartidoCon"];

function clavesEnCualquierNivel(valor: unknown, acumuladas = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) valor.forEach((v) => clavesEnCualquierNivel(v, acumuladas));
  else if (valor !== null && typeof valor === "object") {
    for (const [clave, v] of Object.entries(valor)) {
      acumuladas.add(clave);
      clavesEnCualquierNivel(v, acumuladas);
    }
  }
  return acumuladas;
}

describe("aPlanCompartido: dinero, alojamiento y traslados (pin-ac1)", () => {
  const dueno = () => {
    const { plan: p } = fc.sample(planMulticiudad, 1)[0];
    return { ...aPlanPublico({ ...p, etapas: p.etapas, traslados: p.traslados }, "familiar", 4000), compartidoCon: 1, trabajoId: "t", regenerando: true };
  };

  it("la entrada de ejemplo lleva de verdad lo que la proyección debe quitar", () => {
    const claves = clavesEnCualquierNivel(dueno());
    for (const clave of ["alojamiento_noche_eur", "coste_eur", "presupuesto", "compartidoCon", "trabajoId", "regenerando"]) expect(claves.has(clave)).toBe(true);
  });

  it("cada clave prohibida desaparece en cualquier nivel", () => {
    const claves = clavesEnCualquierNivel(aPlanCompartido(dueno()));
    for (const clave of TODAS_LAS_CLAVES) expect(claves.has(clave), clave).toBe(false);
  });

  it("quita alojamiento_noche_eur de cada etapa y coste_eur de cada traslado, y conserva el resto", () => {
    const entrada = dueno();
    const salida = aPlanCompartido(entrada);
    expect(salida.etapas).toHaveLength(2);
    expect(salida.traslados).toHaveLength(1);
    for (const etapa of salida.etapas ?? []) expect(Object.keys(etapa)).not.toContain("alojamiento_noche_eur");
    for (const traslado of salida.traslados ?? []) expect(Object.keys(traslado)).not.toContain("coste_eur");
    expect(salida.etapas?.[1]).toMatchObject({ pais: "ES", dias: 1, dia_inicio: 1, zona: 0 });
    expect(salida.traslados?.[0]).toMatchObject({ desde: "Sevilla", hasta: "Cádiz", modo: "tren", distancia_km: 125, duracion_min: 90 });
    // La entrada no se toca.
    expect(entrada.etapas?.map((e) => e.alojamiento_noche_eur)).toEqual([90, 110]);
    expect(entrada.traslados?.[0].coste_eur).toBe(35);
  });

  it("un plan sin etapas ni traslados no los inventa", () => {
    const { plan: p } = fc.sample(plan.filter(({ plan: x }) => !x.etapas), 1)[0];
    const salida = aPlanCompartido(aPlanPublico(p, "familiar", 1000));
    expect(salida).not.toHaveProperty("etapas");
    expect(salida).not.toHaveProperty("traslados");
  });

  it("invariante: con etapas y traslados siempre presentes, ninguna clave prohibida en ningún nivel y todo lo demás igual", () => {
    fc.assert(
      fc.property(planMulticiudad, ({ plan: p, presupuesto }) => {
        const entrada = { ...aPlanPublico(p, "familiar", presupuesto), trabajoId: "t", regenerando: true, compartidoCon: 2 };
        const antes = JSON.stringify(entrada);
        const salida = aPlanCompartido(entrada);
        const claves = clavesEnCualquierNivel(salida);
        for (const clave of TODAS_LAS_CLAVES) expect(claves.has(clave), clave).toBe(false);
        expect(salida.etapas).toHaveLength(entrada.etapas?.length ?? 0);
        expect(salida.traslados).toHaveLength(entrada.traslados?.length ?? 0);
        salida.etapas?.forEach((e, i) => {
          expect(e).toEqual({ ...entrada.etapas![i], alojamiento_noche_eur: undefined });
        });
        salida.traslados?.forEach((t, i) => {
          expect(t).toEqual({ ...entrada.traslados![i], coste_eur: undefined });
        });
        expect(JSON.stringify(entrada)).toBe(antes);
      }),
      { numRuns: 200 },
    );
  });
});
