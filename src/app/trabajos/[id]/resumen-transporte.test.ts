import { describe, expect, it } from "vitest";
import { textoTransporte } from "./PantallaProgreso";

describe("textoTransporte (tra-ac1)", () => {
  it("enseña lo elegido o «Cualquier medio»", () => {
    expect(textoTransporte(["tren", "autobus"])).toBe("Tren, autobús");
    expect(textoTransporte([])).toBe("Cualquier medio");
    expect(textoTransporte(undefined)).toBe("Cualquier medio");
  });
});
