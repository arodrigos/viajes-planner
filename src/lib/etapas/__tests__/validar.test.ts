import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Modo } from "@/lib/criterios/tipos";
import { fuenteZonasGrabada } from "@/lib/testing/nominatimGrabado";
import type { Dia } from "@/lib/plan/tipos";
import { clasificarDestino, type Zona } from "../clasificar";
import { maxEtapas } from "../reglas";
import { asignarZona, repararEtapas, trasladosDe, validarEtapas, type ContextoEtapas, type EtapaGeo } from "../validar";

async function zonasDe(destino: string): Promise<Zona[]> {
  const c = await clasificarDestino(fuenteZonasGrabada().fuente, destino);
  if (c.modo !== "multiciudad") throw new Error(`«${destino}» no es multiciudad`);
  return c.zonas;
}

const PUNTOS: Record<string, { lat: number; lon: number }> = {
  Lisboa: { lat: 38.72, lon: -9.14 },
  Coímbra: { lat: 40.21, lon: -8.43 },
  Oporto: { lat: 41.15, lon: -8.61 },
  Faro: { lat: 37.02, lon: -7.93 },
  Sevilla: { lat: 37.39, lon: -5.99 },
};

function etapa(ciudad: string, dias: number, zonas: readonly Zona[], noche = 90): EtapaGeo {
  const punto = PUNTOS[ciudad];
  return { ciudad, pais: ciudad === "Sevilla" ? "España" : "Portugal", dias, alojamiento_noche_eur: noche, punto, zona: asignarZona(punto, zonas), ajustes: [] };
}

function ctx(zonas: Zona[], diasTotales: number, extra: Partial<ContextoEtapas> = {}): ContextoEtapas {
  return { zonas, modos: ["tren", "autobus"], personas: 4, diasTotales, presupuestoEur: 3000, actividadesEur: 240, ...extra };
}

const diasVacios = (n: number): Pick<Dia, "franjas" | "paradas">[] =>
  Array.from({ length: n }, () => ({ franjas: [{ id: "manana" }, { id: "tarde" }, { id: "noche" }], paradas: [] }) as unknown as Pick<Dia, "franjas" | "paradas">);

describe("validarEtapas (eta-ac1 / cp-eta-01)", () => {
  it("Portugal, 8 días: Lisboa 3, Coímbra 1, Oporto 2, Faro 2 → errores del caso", async () => {
    const zonas = await zonasDe("Portugal");
    const e = [etapa("Lisboa", 3, zonas), etapa("Coímbra", 1, zonas), etapa("Oporto", 2, zonas), etapa("Faro", 2, zonas)];
    const textos = validarEtapas(e, ctx(zonas, 8)).map((x) => x.texto);
    expect(textos).toContain("Coímbra: 1 día, el mínimo es 2.");
    expect(textos.some((t) => /^Oporto → Faro: no hay forma de ir en menos de 4 h/.test(t))).toBe(true);
    expect(textos.some((t) => /4 etapas son demasiadas para 8 días: el máximo es 3/.test(t))).toBe(true);
  });

  it("tras reparar: ≤3 etapas, ≥2 días, trayectos válidos y ajustes con ciudad", async () => {
    const zonas = await zonasDe("Portugal");
    const c = ctx(zonas, 8);
    const r = repararEtapas([etapa("Lisboa", 3, zonas), etapa("Coímbra", 1, zonas), etapa("Oporto", 2, zonas), etapa("Faro", 2, zonas)], c);
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r.every((x) => x.dias >= 2)).toBe(true);
    expect(trasladosDe(r, c.modos, c.personas).every((t) => t !== null)).toBe(true);
    expect(validarEtapas(r, c)).toEqual([]);
    const ajustes = r.flatMap((x) => x.ajustes);
    expect(ajustes.length).toBeGreaterThan(0);
    expect(ajustes.some((a) => /Coímbra|Faro/.test(a))).toBe(true);
  });

  it("propuesta válida: sin errores y sin ajustes", async () => {
    const zonas = await zonasDe("Portugal");
    const c = ctx(zonas, 8);
    const e = [etapa("Lisboa", 4, zonas), etapa("Oporto", 4, zonas)];
    expect(validarEtapas(e, c)).toEqual([]);
    expect(repararEtapas(e, c)).toEqual(e);
  });

  it("«Portugal y España» con solo ciudades portuguesas: zona sin etapa", async () => {
    const zonas = await zonasDe("Portugal y España");
    const errores = validarEtapas([etapa("Lisboa", 4, zonas), etapa("Oporto", 4, zonas)], ctx(zonas, 8));
    expect(errores.map((x) => x.texto)).toContain("No hemos podido incluir España con estas reglas.");
    expect(errores.every((x) => x.codigo === "zona-sin-etapa")).toBe(true);
  });

  it("ciudad repetida", async () => {
    const zonas = await zonasDe("Portugal");
    const textos = validarEtapas([etapa("Lisboa", 3, zonas), etapa("Oporto", 2, zonas), etapa("Lisboa", 3, zonas)], ctx(zonas, 8)).map((x) => x.texto);
    expect(textos).toContain("Lisboa aparece en más de una etapa.");
  });

  it("días que no suman el viaje (no contiguos)", async () => {
    const zonas = await zonasDe("Portugal");
    const textos = validarEtapas([etapa("Lisboa", 3, zonas), etapa("Oporto", 3, zonas)], ctx(zonas, 8)).map((x) => x.texto);
    expect(textos).toContain("Las etapas suman 6 días y el viaje tiene 8.");
  });

  it("viaje de 3 días: etapas de 1 día permitidas", async () => {
    const zonas = await zonasDe("Portugal");
    const textos = validarEtapas([etapa("Lisboa", 1, zonas), etapa("Coímbra", 1, zonas), etapa("Oporto", 1, zonas)], ctx(zonas, 3)).map((x) => x.texto);
    expect(textos.some((t) => /el mínimo es 2/.test(t))).toBe(false);
  });

  it("7 etapas en 10 días: demasiadas", async () => {
    const zonas = await zonasDe("Portugal");
    const e = ["Lisboa", "Coímbra", "Oporto", "Faro", "Sevilla", "Lisboa", "Oporto"].map((c, i) => etapa(c + (i > 4 ? "" : ""), i < 3 ? 2 : 1, zonas));
    expect(validarEtapas(e, ctx(zonas, 10)).map((x) => x.texto).join("\n")).toMatch(/7 etapas son demasiadas para 10 días: el máximo es 4/);
  });

  it("etapa fuera de las zonas pedidas", async () => {
    const zonas = await zonasDe("Portugal");
    const textos = validarEtapas([etapa("Lisboa", 4, zonas), etapa("Sevilla", 4, zonas)], ctx(zonas, 8)).map((x) => x.texto);
    expect(textos).toContain("Sevilla no está dentro de ninguna de las zonas que has pedido.");
  });

  it("presupuesto superado: código presupuesto con desglose", async () => {
    const zonas = await zonasDe("Portugal");
    const errores = validarEtapas([etapa("Lisboa", 4, zonas, 90), etapa("Oporto", 4, zonas, 80)], ctx(zonas, 8, { presupuestoEur: 500 }));
    const p = errores.find((x) => x.codigo === "presupuesto");
    expect(p).toBeDefined();
    expect(p?.texto).toMatch(/alojamiento/);
  });

  it("llegada: la primera franja del día de llegada ocupada se señala", async () => {
    const zonas = await zonasDe("Portugal");
    const dias = diasVacios(8);
    (dias[4] as unknown as { paradas: unknown[] }).paradas = [{ franja_id: "manana" }];
    const errores = validarEtapas([etapa("Lisboa", 4, zonas), etapa("Oporto", 4, zonas)], ctx(zonas, 8), dias);
    expect(errores.map((x) => x.texto).join("\n")).toMatch(/día 5 es de llegada/);
  });
});

describe("invariantes de etapas (property)", () => {
  const ciudades = ["Lisboa", "Coímbra", "Oporto", "Faro"] as const;
  const propuesta = fc.record({
    total: fc.integer({ min: 4, max: 14 }),
    orden: fc.shuffledSubarray([...ciudades], { minLength: 1, maxLength: 4 }),
    pesos: fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 4, maxLength: 4 }),
  });

  // Reparte `total` días entre las ciudades en proporción a los pesos.
  function montar(zonas: Zona[], p: { total: number; orden: string[]; pesos: number[] }): EtapaGeo[] {
    const n = p.orden.length;
    const dias = p.orden.map((_, i) => ({ i, d: 1 }));
    let resto = p.total - n;
    for (let k = 0; resto > 0; k++, resto--) dias[p.pesos[k % 4] % n].d++;
    return p.orden.map((c, i) => etapa(c, Math.max(1, dias[i].d), zonas)).filter((e) => e.dias > 0);
  }

  it("1/2: tras reparar, días contiguos que suman el viaje, sin repetidas, ≤tope, ≥2 días", async () => {
    const zonas = await zonasDe("Portugal");
    fc.assert(
      fc.property(propuesta, (p) => {
        const e = montar(zonas, p);
        const total = e.reduce((s, x) => s + x.dias, 0);
        const r = repararEtapas(e, ctx(zonas, total));
        expect(r.reduce((s, x) => s + x.dias, 0)).toBe(total);
        expect(r.length).toBeLessThanOrEqual(Math.min(6, maxEtapas(total)));
        expect(new Set(r.map((x) => x.ciudad)).size).toBe(r.length);
        if (total > 3) expect(r.every((x) => x.dias >= 2)).toBe(true);
        expect(r.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 200 },
    );
  });

  it("7: repararEtapas es idempotente", async () => {
    const zonas = await zonasDe("Portugal");
    fc.assert(
      fc.property(propuesta, (p) => {
        const c = ctx(zonas, p.total);
        const e = montar(zonas, p);
        const una = repararEtapas(e, c);
        expect(repararEtapas(una, c)).toEqual(una);
      }),
      { numRuns: 200 },
    );
  });

  it("6: con las etapas válidas y las franjas de llegada libres no hay errores de llegada; ocupadas siempre se señalan", async () => {
    const zonas = await zonasDe("Portugal");
    const modos: Modo[] = ["tren", "autobus"];
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 }), (franja) => {
        const c = ctx(zonas, 8, { modos });
        const e = [etapa("Lisboa", 4, zonas), etapa("Oporto", 4, zonas)];
        const libres = diasVacios(8);
        expect(validarEtapas(e, c, libres)).toEqual([]);
        const ocupados = diasVacios(8);
        const ids = ["manana", "tarde", "noche"];
        (ocupados[4] as unknown as { paradas: unknown[] }).paradas = [{ franja_id: ids[franja] }];
        const errs = validarEtapas(e, c, ocupados).filter((x) => /llegada/.test(x.texto));
        // Solo la primera franja (y la segunda si el trayecto >240 min) deben quedar libres.
        if (franja === 0) expect(errs.length).toBeGreaterThan(0);
      }),
    );
  });
});
