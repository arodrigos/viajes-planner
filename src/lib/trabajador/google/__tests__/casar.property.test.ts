import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { distanciaMetros } from "@/lib/alternativas/equivalencia";
import { buscarEnGoogle, elegirCoincidencia, rectanguloAlrededor, type ResultadoGoogle } from "../casar";

const ancla = fc.record({ lat: fc.double({ min: -60, max: 70, noNaN: true }), lon: fc.double({ min: -179, max: 179, noNaN: true }) });
const resultado = fc.record({
  id: fc.string({ minLength: 1 }),
  location: fc.option(
    fc.record({ latitude: fc.double({ min: -80, max: 80, noNaN: true }), longitude: fc.double({ min: -180, max: 180, noNaN: true }) }),
    { nil: undefined },
  ),
});

describe("invariantes del casado", () => {
  it("cas-inv1: un place_id solo se acepta si su ubicación está a ≤ umbral del ancla", () => {
    fc.assert(
      fc.property(ancla, fc.integer({ min: 50, max: 2000 }), fc.array(resultado, { maxLength: 6 }), (a, umbral, resultados: ResultadoGoogle[]) => {
        const elegido = elegirCoincidencia(a, umbral, resultados);
        if (elegido === null) return;
        const origen = resultados.find((r) => r.id === elegido && r.location && distanciaMetros(a, { lat: r.location.latitude, lon: r.location.longitude }) <= umbral);
        expect(origen).toBeDefined();
      }),
    );
  });

  it("cas-inv1b: si hay algún resultado dentro del umbral, siempre se elige uno", () => {
    fc.assert(
      fc.property(ancla, fc.integer({ min: 50, max: 2000 }), fc.array(resultado, { maxLength: 6 }), (a, umbral, resultados: ResultadoGoogle[]) => {
        const hayDentro = resultados.some((r) => r.location && distanciaMetros(a, { lat: r.location.latitude, lon: r.location.longitude }) <= umbral);
        expect(elegirCoincidencia(a, umbral, resultados) !== null).toBe(hayDentro);
      }),
    );
  });

  it("el rectángulo de la petición siempre contiene el ancla", () => {
    fc.assert(
      fc.property(ancla, fc.integer({ min: 50, max: 2000 }), (a, umbral) => {
        const r = rectanguloAlrededor(a, umbral);
        expect(r.low.latitude).toBeLessThanOrEqual(a.lat);
        expect(r.high.latitude).toBeGreaterThanOrEqual(a.lat);
        expect(r.low.longitude).toBeLessThanOrEqual(a.lon);
        expect(r.high.longitude).toBeGreaterThanOrEqual(a.lon);
      }),
    );
  });

  it("cas-inv5: para cualquier clave, ni la URL ni el mensaje de error la contienen", async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[A-Za-z0-9_-]{35}$/).map((s) => `AIza${s}`), fc.constantFrom(200, 403, 429, 500), async (clave, estado) => {
        let url = "";
        const peticion = async (u: string) => {
          url = u;
          return new Response(`eco ${clave}`, { status: estado });
        };
        const fallo = await buscarEnGoogle(peticion, clave, "Museo, Ciudad", { lat: 40, lon: -3 }, 300).then(
          () => null,
          (e: Error) => e,
        );
        expect(url.includes(clave)).toBe(false);
        if (fallo) expect(fallo.message.includes(clave)).toBe(false);
      }),
      { numRuns: 50 },
    );
  });
});
