import { describe, expect, it } from "vitest";
import { seleccionarPendientes } from "@/lib/trabajador/barrido";

// rel-ac3: con tres planes de fechas distintas y limite=2, gana el plan más
// próximo a "hoy" -- tanto el futuro lejano como el pasado quedan detrás,
// al mismo nivel de prioridad baja.
describe("seleccionarPendientes (rel-ac3)", () => {
  it("prioriza la fecha más próxima a hoy sobre las lejanas o pasadas", () => {
    const hoy = "2026-10-03";
    const candidatos = [
      { paradaId: "lejano-futuro", fecha: "2027-06-01" },
      { paradaId: "proximo", fecha: "2026-10-05" },
      { paradaId: "pasado", fecha: "2026-09-29" },
    ];

    const seleccionados = seleccionarPendientes(candidatos, 2, hoy);

    expect(seleccionados.map((c) => c.paradaId)).toEqual(["proximo", "pasado"]);
  });

  it("un día 'en curso' (hoy) gana a cualquier otro", () => {
    const hoy = "2026-10-03";
    const candidatos = [
      { paradaId: "manana", fecha: "2026-10-04" },
      { paradaId: "hoy", fecha: "2026-10-03" },
      { paradaId: "ayer", fecha: "2026-10-02" },
    ];

    const seleccionados = seleccionarPendientes(candidatos, 1, hoy);

    expect(seleccionados.map((c) => c.paradaId)).toEqual(["hoy"]);
  });

  it("respeta el límite y conserva campos adicionales del candidato", () => {
    const candidatos = [
      { paradaId: "a", fecha: "2026-10-03", nombre: "Museo A" },
      { paradaId: "b", fecha: "2026-10-04", nombre: "Museo B" },
      { paradaId: "c", fecha: "2026-10-10", nombre: "Museo C" },
    ];

    const seleccionados = seleccionarPendientes(candidatos, 2, "2026-10-03");

    expect(seleccionados).toHaveLength(2);
    expect(seleccionados[0].nombre).toBe("Museo A");
  });
});
