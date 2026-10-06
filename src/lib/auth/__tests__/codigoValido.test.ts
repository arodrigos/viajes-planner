import { describe, expect, it } from "vitest";
import { CODIGO_VALIDO } from "@/lib/auth/codigoValido";

// Caso real de una incidencia anterior: Supabase Auth del proyecto DEV real
// emite el código en 8 dígitos, no en los 6 que cita la documentación. El
// producto no debe fijar una longitud que decide un servicio externo.
describe("CODIGO_VALIDO", () => {
  it("acepta 6 dígitos (valor por defecto de la documentación de Supabase)", () => {
    expect(CODIGO_VALIDO.test("123456")).toBe(true);
  });

  it("acepta 8 dígitos (el ajuste real del proyecto DEV)", () => {
    expect(CODIGO_VALIDO.test("12345678")).toBe(true);
  });

  it("rechaza menos de 6 dígitos", () => {
    expect(CODIGO_VALIDO.test("12345")).toBe(false);
  });

  it("rechaza más de 10 dígitos", () => {
    expect(CODIGO_VALIDO.test("12345678901")).toBe(false);
  });

  it("rechaza cualquier carácter que no sea un dígito", () => {
    expect(CODIGO_VALIDO.test("1234a6")).toBe(false);
    expect(CODIGO_VALIDO.test("")).toBe(false);
  });
});
