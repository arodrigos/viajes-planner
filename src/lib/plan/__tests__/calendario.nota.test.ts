import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { franjasComoArray } from "../config-franjas";
import { generarIcsPlan } from "../calendario";
import type { OpcionesTramos } from "../tramos";
import type { Plan } from "../tipos";

const SIN_OPCIONES: OpcionesTramos = { perfil: null };

function planConNota(nota: string | undefined): Plan {
  const franjas = franjasComoArray("Fez");
  return {
    id: "plan-ics-nota",
    version: 1,
    destino: "Fez",
    personas: 2,
    dias: [
      {
        fecha: "2026-11-07",
        franjas,
        paradas: [
          {
            id: "propia-1",
            franja_id: franjas[0].id,
            nombre: "Heladería Fassi",
            descripcion: "",
            duracion_min: 60,
            prioridad: 50,
            procedencia: { fuente: "propuesto-sin-verificar" },
            propia: true,
            ...(nota !== undefined ? { nota } : {}),
          },
        ],
      },
    ],
  };
}

// Las líneas largas se pliegan (CRLF + espacio); se deshace antes de buscar.
const desplegar = (ics: string) => ics.replace(/\r\n[ \t]/g, "");

describe("la nota de un sitio propio en el .ics (spu-ac5)", () => {
  it("escapa comas, punto y coma, barras y saltos de línea según RFC 5545", () => {
    const { contenido } = generarIcsPlan(planConNota("<img src=x onerror=alert(1)>, ir; a\\merendar"), SIN_OPCIONES);
    expect(desplegar(contenido)).toContain("<img src=x onerror=alert(1)>\\, ir\\; a\\\\merendar");
  });

  it("sin nota, la descripción es la de siempre", () => {
    const { contenido } = generarIcsPlan(planConNota(undefined), SIN_OPCIONES);
    expect(desplegar(contenido)).toContain("DESCRIPTION:\\n\\nHorario orientativo");
  });

  it("para cualquier nota, el fichero conserva una sola línea DESCRIPTION y ninguna línea que la nota haya inventado", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (nota) => {
        const lineas = desplegar(generarIcsPlan(planConNota(nota), SIN_OPCIONES).contenido).split("\r\n");
        // Un salto de línea sin escapar dentro de la nota abriría una propiedad nueva.
        expect(lineas.filter((l) => l.startsWith("DESCRIPTION"))).toHaveLength(1);
        expect(lineas.every((l) => l === "" || /^[A-Z][A-Z0-9-]*[;:]/.test(l))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
