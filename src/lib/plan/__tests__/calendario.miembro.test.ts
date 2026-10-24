import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { franjasComoArray } from "../config-franjas";
import { generarIcsPlan } from "../calendario";
import type { OpcionesTramos } from "../tramos";
import type { Plan } from "../tipos";

const SIN_OPCIONES: OpcionesTramos = { perfil: null };

// pin-ac4: generarIcsPlan recibe el plan interno (con ancla y costes) y es la
// ruta quien debe garantizar que el miembro no ve dinero ni dónde duerme.
const coordenada = fc.record({ lat: fc.integer({ min: 3900000, max: 3999999 }).filter((n) => n % 100000 !== 0).map((n) => n / 100000), lon: fc.integer({ min: 10000, max: 99999 }).filter((n) => n % 100000 !== 0).map((n) => -n / 100000) });
// Sin coordenadas enteras (p. ej. 39): su texto es una subcadena trivial de cualquier fecha o identificador y el test fallaría sin que se filtre nada.

const plan = fc.record({ ancla: coordenada, noche: fc.integer({ min: 70001, max: 79999 }), n: fc.integer({ min: 1, max: 3 }) }).map(
  ({ ancla, noche, n }): { plan: Plan; ancla: { lat: number; lon: number } } => {
    const franjas = franjasComoArray("Sevilla");
    return {
      ancla,
      plan: {
        id: "p",
        version: 1,
        destino: "Sevilla",
        personas: 2,
        etapas: [{ ciudad: { estado: "resuelta", nombre: "Sevilla", intentado_en: "2026-10-01T00:00:00Z" }, pais: "ES", dias: 1, dia_inicio: 0, alojamiento_noche_eur: noche, zona: 0, ajustes: [] }],
        dias: [
          {
            fecha: "2027-03-05",
            etapa: 0,
            // Las coordenadas del ancla son las únicas del plan: si salen en el .ics, son las del alojamiento.
            ancla_alojamiento: { tipo: "zona-propuesta", centroide: ancla, radio_m: 500 },
            franjas,
            paradas: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, franja_id: franjas[0].id, nombre: `Sitio ${i}`, descripcion: "Visita", duracion_min: 60, prioridad: 50, procedencia: { fuente: "propuesto-sin-verificar" as const } })),
          },
        ],
      },
    };
  },
);

describe("generarIcsPlan con un plan que lleva ancla y costes (pin-ac4)", () => {
  it("invariante: el .ics no contiene las coordenadas del ancla ni importes en euros", () => {
    fc.assert(
      fc.property(plan, ({ plan: p, ancla }) => {
        const { contenido } = generarIcsPlan(p, SIN_OPCIONES);
        expect(contenido).toContain("Sitio 0");
        // El UID y el DTSTAMP son aleatorios: se excluyen para que el test no dependa del azar.
        const visible = contenido.split(/\r?\n/).filter((l) => !/^(UID|DTSTAMP):/.test(l)).join("\n");
        expect(visible).not.toContain(String(ancla.lat));
        expect(visible).not.toContain(String(ancla.lon));
        expect(visible).not.toMatch(/€|EUR|alojamiento/i);
      }),
      { numRuns: 100 },
    );
  });
});
