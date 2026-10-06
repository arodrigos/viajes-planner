import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CriteriosViaje, Modo } from "@/lib/criterios/tipos";
import { MODOS_TRANSPORTE } from "@/lib/criterios/tipos";
import { clasificarDestino, type Zona } from "../clasificar";
import { PISO_ALOJAMIENTO_EUR } from "../constantes";
import { maxEtapas, nochesDe } from "../reglas";
import { estimarTraslado } from "../traslados";
import { comprobarViabilidad, distanciaMinimaEntreCajas } from "../viabilidad";
import { fuenteZonasGrabada } from "@/lib/testing/nominatimGrabado";

async function zonasDe(destino: string): Promise<{ zonas: Zona[]; pedidas: number }> {
  const c = await clasificarDestino(fuenteZonasGrabada().fuente, destino);
  if (c.modo !== "multiciudad") throw new Error(`«${destino}» no es multiciudad`);
  return { zonas: c.zonas, pedidas: c.pedidas };
}

function criterios(dias: number, presupuesto: number, transporte?: Modo[]): CriteriosViaje {
  return {
    destino_o_tipo: "x",
    fechas: { modo: "epoca", epoca: "verano" },
    dias,
    personas: [{ edad: 41 }, { edad: 39 }, { edad: 11 }, { edad: 8 }],
    perfil: "familiar",
    presupuesto_eur: presupuesto,
    ...(transporte ? { transporte } : {}),
  };
}

describe("comprobarViabilidad (dmc-ac2 / cp-dmc-02)", () => {
  it("«Portugal y Grecia», 10 días, tren y autobús: inviable por distancia con cifras", async () => {
    const { zonas } = await zonasDe("Portugal, Grecia");
    const r = comprobarViabilidad(zonas, criterios(10, 5000, ["tren", "autobus"]));
    expect(r.viable).toBe(false);
    if (r.viable) return;
    expect(r.razones[0].codigo).toBe("distancia");
    expect(r.razones[0].texto).toMatch(/Portugal/);
    expect(r.razones[0].texto).toMatch(/Grecia/);
    expect(r.razones[0].texto).toMatch(/\d[\d.]* km/);
    expect(r.razones[0].texto).toMatch(/4 h/);
    expect(r.sugerencias).toContain("Marca «Avión» o elige países más cercanos.");
  });

  it("«Portugal, España e Italia», 5 días: inviable por días", async () => {
    const { zonas, pedidas } = await zonasDe("Portugal, España e Italia");
    const r = comprobarViabilidad(zonas, criterios(5, 5000), pedidas);
    expect(r.viable).toBe(false);
    if (r.viable) return;
    expect(r.razones[0].codigo).toBe("dias");
    expect(r.razones[0].texto).toBe("Con 5 días caben como mucho 2 ciudades (una cada 3 días) y has pedido 3 países.");
  });

  it("«Portugal», 8 días, 300 €: inviable por presupuesto con el coste mínimo", async () => {
    const { zonas } = await zonasDe("Portugal");
    const r = comprobarViabilidad(zonas, criterios(8, 300));
    expect(r.viable).toBe(false);
    if (r.viable) return;
    expect(r.razones[0].codigo).toBe("presupuesto");
    expect(r.razones[0].texto).toContain("7 noches × 4 personas × 20 € = 560 €");
    expect(r.razones[0].texto).toContain("300 €");
  });

  it("«Portugal y España», 8 días, tren, 3.000 €: viable", async () => {
    const { zonas } = await zonasDe("Portugal y España");
    expect(comprobarViabilidad(zonas, criterios(8, 3000, ["tren"]))).toEqual({ viable: true });
  });

  it("«Portugal y Grecia», 10 días, avión y tren, 5.000 €: viable (el salto cabe en avión)", async () => {
    const { zonas } = await zonasDe("Portugal, Grecia");
    expect(comprobarViabilidad(zonas, criterios(10, 5000, ["avion", "tren"]))).toEqual({ viable: true });
  });

  it("sin medios marcados vale cualquier medio y la sugerencia no repite el avión", async () => {
    const { zonas } = await zonasDe("Portugal, Grecia");
    expect(comprobarViabilidad(zonas, criterios(10, 5000))).toEqual({ viable: true });
  });

  it("con 7 o más países descarta por días sin tocar la red", async () => {
    const { fuente, peticiones } = fuenteZonasGrabada();
    const c = await clasificarDestino(fuente, "Portugal, España, Italia, Grecia, Alemania, Francia, Portugal");
    const hechas = peticiones.length;
    if (c.modo !== "multiciudad") throw new Error("esperaba multiciudad");
    const r = comprobarViabilidad(c.zonas, criterios(30, 50000), c.pedidas);
    expect(r.viable).toBe(false);
    if (!r.viable) expect(r.razones[0].codigo).toBe("dias");
    expect(peticiones.length).toBe(hechas);
  });

  it("dos cajas que se tocan están a 0 km", async () => {
    const { zonas } = await zonasDe("Portugal y España");
    expect(distanciaMinimaEntreCajas(zonas[0].caja, zonas[1].caja)).toBe(0);
  });

  // Invariante 3: si declara inviable un viaje, ningún reparto aleatorio de
  // etapas dentro de esas zonas que cumpla las reglas y respete los pisos de
  // coste lo pasaría. Se prueba por contraposición: cualquier reparto que
  // cumple las reglas implica que comprobarViabilidad lo da por viable.
  it("invariante: conservadora frente a cualquier reparto aleatorio que cumple las reglas", () => {
    const caja = fc
      .record({ lat: fc.double({ min: -60, max: 60, noNaN: true }), lon: fc.double({ min: -170, max: 170, noNaN: true }), alto: fc.double({ min: 0.5, max: 12, noNaN: true }), ancho: fc.double({ min: 0.5, max: 12, noNaN: true }) })
      .map((c) => ({ minLat: c.lat, maxLat: c.lat + c.alto, minLon: c.lon, maxLon: c.lon + c.ancho }));
    const zona = caja.map((c): Zona => ({ nombre: "z", tipo: "country", codigo_pais: null, caja: c, punto: { lat: (c.minLat + c.maxLat) / 2, lon: (c.minLon + c.maxLon) / 2 } }));
    const repartoAleatorio = fc.record({
      zonas: fc.array(zona, { minLength: 1, maxLength: 4 }),
      // Posición de cada etapa dentro de su zona, como fracción de la caja.
      fracciones: fc.array(fc.tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true })), { minLength: 4, maxLength: 4 }),
      orden: fc.shuffledSubarray([0, 1, 2, 3], { minLength: 4, maxLength: 4 }),
      dias: fc.integer({ min: 1, max: 30 }),
      presupuesto: fc.integer({ min: 0, max: 20000 }),
      modos: fc.subarray([...MODOS_TRANSPORTE] as Modo[]),
    });
    fc.assert(
      fc.property(repartoAleatorio, ({ zonas, fracciones, orden, dias, presupuesto, modos }) => {
        const c = criterios(dias, presupuesto, modos.length > 0 ? modos : undefined);
        const personas = c.personas.length;
        // Una etapa por zona, en un orden aleatorio.
        const indices = orden.filter((i) => i < zonas.length);
        const puntos = indices.map((i) => ({
          lat: zonas[i].caja.minLat + fracciones[i][0] * (zonas[i].caja.maxLat - zonas[i].caja.minLat),
          lon: zonas[i].caja.minLon + fracciones[i][1] * (zonas[i].caja.maxLon - zonas[i].caja.minLon),
        }));
        if (indices.length > maxEtapas(dias)) return;
        let traslados = 0;
        for (let k = 0; k < puntos.length - 1; k++) {
          const t = estimarTraslado(puntos[k], puntos[k + 1], modos, personas);
          if (!t) return;
          traslados += t.coste_eur;
        }
        if (nochesDe(dias) * personas * PISO_ALOJAMIENTO_EUR + traslados > presupuesto) return;
        expect(comprobarViabilidad(zonas, c)).toEqual({ viable: true });
      }),
      { numRuns: 400 },
    );
  });
});
