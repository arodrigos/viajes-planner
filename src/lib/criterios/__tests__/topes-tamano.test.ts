import { describe, expect, it } from "vitest";
import { validarCriterios } from "@/lib/criterios/validar";

const BASE = {
  destino_o_tipo: "Roma",
  fechas: { modo: "fechas", inicio: "2026-12-01", fin: "2026-12-05" },
  dias: 5,
  personas: [{ edad: 40 }],
  perfil: "familiar",
  presupuesto_eur: 1500,
};

describe("criterios: topes de tamaño en lo que escribe el usuario", () => {
  it("acepta los valores en el límite", () => {
    expect(validarCriterios({ ...BASE, destino_o_tipo: "a".repeat(120) }).valido).toBe(true);
    expect(validarCriterios({ ...BASE, alojamiento: { direccion: "a".repeat(200) } }).valido).toBe(true);
    expect(validarCriterios({ ...BASE, fechas: { modo: "epoca", epoca: "a".repeat(60) } }).valido).toBe(true);
    expect(validarCriterios({ ...BASE, personas: Array.from({ length: 20 }, () => ({ edad: 30 })) }).valido).toBe(true);
  });

  it("rechaza lo que pasa del límite", () => {
    expect(validarCriterios({ ...BASE, destino_o_tipo: "a".repeat(121) }).valido).toBe(false);
    expect(validarCriterios({ ...BASE, alojamiento: { direccion: "a".repeat(201) } }).valido).toBe(false);
    expect(validarCriterios({ ...BASE, fechas: { modo: "epoca", epoca: "a".repeat(61) } }).valido).toBe(false);
    expect(validarCriterios({ ...BASE, personas: Array.from({ length: 21 }, () => ({ edad: 30 })) }).valido).toBe(false);
  });
});
