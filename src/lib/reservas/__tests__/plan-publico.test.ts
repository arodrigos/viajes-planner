import { describe, expect, it } from "vitest";
import { aPlanCompartido } from "@/lib/plan/compartido";
import { aPlanPublico } from "@/lib/plan/publico";
import { planSemilla } from "@/test-utils/semilla-compartir";
import type { Reserva } from "../tipos";

const RESERVAS: Reserva[] = [
  { id: "v", tipo: "vuelo", sentido: "ida", origen: "MAD", destino: "FCO", fecha_inicio: "2027-03-05", hora_inicio: "08:00", fecha_fin: "2027-03-05", hora_fin: "13:00", localizador: "SECRETO1", notas: "pasaporte" },
  { id: "h", tipo: "hotel", nombre: "Hotel Sole", direccion: "Via Roma 1", fecha_inicio: "2027-03-05", fecha_fin: "2027-03-07" },
  { id: "e", tipo: "entrada", nombre: "Borghese", fecha_inicio: "2027-03-05", hora_inicio: "10:30" },
];

describe("PlanPublico.reservas (res-ac5)", () => {
  it("el invitado recibe solo id, tipo, sentido, fecha y hora de cada reserva", () => {
    const json = JSON.stringify(aPlanCompartido(aPlanPublico(planSemilla("p"), null, null, null, null, RESERVAS)));
    for (const secreto of ["SECRETO1", "pasaporte", "Hotel Sole", "Via Roma", "Borghese", "MAD", "FCO"]) expect(json).not.toContain(secreto);
    const { reservas } = JSON.parse(json) as { reservas: Record<string, unknown>[] };
    expect(reservas).toHaveLength(3);
    for (const r of reservas) expect(Object.keys(r).every((k) => ["id", "tipo", "sentido", "fecha", "hora"].includes(k))).toBe(true);
  });

  it("sin reservas no aparece la clave", () => {
    expect("reservas" in aPlanPublico(planSemilla("p"))).toBe(false);
  });
});
