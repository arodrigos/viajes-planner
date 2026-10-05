import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clasificarDestino } from "../clasificar";
import { fuenteZonasGrabada } from "@/lib/testing/nominatimGrabado";

// dmc-ac1 / cp-dmc-01: fixtures reales de Nominatim servidas por un fetch que
// cuenta peticiones.
async function clasificar(destino: string) {
  const { fuente, peticiones } = fuenteZonasGrabada();
  const clasificacion = await clasificarDestino(fuente, destino);
  const primeras = peticiones.length;
  await clasificarDestino(fuente, destino);
  return { clasificacion, primeras, trasRepetir: peticiones.length };
}

function paises(c: Awaited<ReturnType<typeof clasificar>>): string[] {
  return c.clasificacion.modo === "multiciudad" ? c.clasificacion.zonas.map((z) => z.codigo_pais ?? "?") : [];
}

describe("clasificarDestino (dmc-ac1)", () => {
  it("Portugal es multiciudad con 1 zona pt y 1 petición", async () => {
    const r = await clasificar("Portugal");
    expect(r.clasificacion.modo).toBe("multiciudad");
    expect(paises(r)).toEqual(["pt"]);
    expect(r.primeras).toBe(1);
  });

  it("una región grande (Andalucía, ~2,8 grados) es multiciudad con 1 zona es", async () => {
    const r = await clasificar("Andalucía");
    expect(r.clasificacion.modo).toBe("multiciudad");
    expect(paises(r)).toEqual(["es"]);
  });

  it("«Portugal y España» se parte: 2 zonas (pt, es) y 3 peticiones", async () => {
    const r = await clasificar("Portugal y España");
    expect(paises(r)).toEqual(["pt", "es"]);
    expect(r.primeras).toBe(3);
  });

  it("«Portugal, España e Italia» da 3 zonas", async () => {
    const r = await clasificar("Portugal, España e Italia");
    expect(paises(r)).toEqual(["pt", "es", "it"]);
    expect(r.primeras).toBe(4);
  });

  it("«Bosnia y Herzegovina» se resuelve entero como país y no se parte: 1 petición", async () => {
    const r = await clasificar("Bosnia y Herzegovina");
    expect(paises(r)).toEqual(["ba"]);
    expect(r.primeras).toBe(1);
  });

  it("una ciudad y un texto que no es lista de países siguen el flujo de ciudad", async () => {
    expect((await clasificar("Sevilla")).clasificacion.modo).toBe("ciudad");
    expect((await clasificar("Londres en familia con niños")).clasificacion.modo).toBe("ciudad");
  });

  it("«Lisboa y Oporto» (dos ciudades) sigue por el flujo de una ciudad", async () => {
    const r = await clasificar("Lisboa y Oporto");
    expect(r.clasificacion.modo).toBe("ciudad");
    // Entero + «Lisboa»; «Lisboa» no es zona grande y corta ahí.
    expect(r.primeras).toBe(2);
  });

  it("con la caché llena no hace ninguna petición más", async () => {
    for (const destino of ["Portugal", "Portugal y España", "Sevilla", "Londres en familia con niños"]) {
      const r = await clasificar(destino);
      expect(r.trasRepetir, destino).toBe(r.primeras);
    }
  });

  it("un error de red da modo ciudad y nunca lanza", async () => {
    const { fuente } = fuenteZonasGrabada({ sinRed: true });
    await expect(clasificarDestino(fuente, "Portugal y España")).resolves.toEqual({ modo: "ciudad" });
  });

  it("una fuente que no sabe geocodificar zonas da modo ciudad sin tocar nada", async () => {
    const { fuente } = fuenteZonasGrabada();
    const sinZonas = { ...fuente, geocodificarZona: undefined };
    await expect(clasificarDestino(sinZonas, "Portugal")).resolves.toEqual({ modo: "ciudad" });
  });

  it("más de 6 trozos de países: solo se geocodifican 6 y se cuentan todos los pedidos", async () => {
    const { fuente, peticiones } = fuenteZonasGrabada();
    const c = await clasificarDestino(fuente, "Portugal, España, Italia, Grecia, Alemania, Francia, Portugal, España");
    expect(c.modo === "multiciudad" && c.pedidas).toBe(8);
    expect(peticiones.length).toBeLessThanOrEqual(7);
  });

  // Invariante 1: como mucho 1 + 6 peticiones por destino, 0 con la caché
  // llena, y un error de red siempre da modo ciudad.
  it("invariante: ≤ 7 peticiones, 0 con caché llena, y sin red siempre ciudad", async () => {
    const nombres = ["Portugal", "España", "Italia", "Grecia", "Sevilla", "Lisboa", "Andalucía", "Bosnia y Herzegovina", "algo inventado"];
    const separador = fc.constantFrom(", ", " y ", " e ", " + ", "/");
    const destino = fc
      .array(fc.constantFrom(...nombres), { minLength: 1, maxLength: 9 })
      .chain((trozos) => fc.array(separador, { minLength: trozos.length, maxLength: trozos.length }).map((seps) => trozos.map((t, i) => (i === 0 ? t : seps[i] + t)).join("")));
    await fc.assert(
      fc.asyncProperty(destino, async (texto) => {
        const { fuente, peticiones } = fuenteZonasGrabada();
        await clasificarDestino(fuente, texto);
        const primeras = peticiones.length;
        expect(primeras).toBeLessThanOrEqual(7);
        await clasificarDestino(fuente, texto);
        expect(peticiones.length).toBe(primeras);
        const caida = fuenteZonasGrabada({ sinRed: true });
        expect(await clasificarDestino(caida.fuente, texto)).toEqual({ modo: "ciudad" });
      }),
      { numRuns: 60 },
    );
  });

  // Invariante 2: lo que Nominatim resuelve entero como país nunca se parte.
  it("invariante: un destino resuelto entero como país nunca se parte", async () => {
    const { fuente } = fuenteZonasGrabada();
    for (const destino of ["Bosnia y Herzegovina", "Portugal", "España"]) {
      const c = await clasificarDestino(fuente, destino);
      expect(c.modo === "multiciudad" && c.zonas.length).toBe(1);
    }
  });
});
