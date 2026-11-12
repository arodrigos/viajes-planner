import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { IDS_PREPARATIVOS } from "../catalogo";
import { ESTADOS_MARCA, validarMarca } from "../validar";

const AHORA = Date.parse("2027-06-01T12:00:00Z");
const id = [...IDS_PREPARATIVOS][0];

describe("validarMarca (dat-ac4)", () => {
  it("acepta una marca válida y normaliza la fecha a ISO", () => {
    const r = validarMarca(id, { estado: "hecho", actualizado_cliente: "2027-06-01T10:00:00Z" }, AHORA);
    expect(r).toEqual({ ok: true, marca: { estado: "hecho", actualizado_cliente: "2027-06-01T10:00:00.000Z" } });
  });

  it.each([
    ["elemento fuera del catálogo", "no-existe", { estado: "hecho", actualizado_cliente: "2027-06-01T10:00:00Z" }],
    ["estado desconocido", id, { estado: "listo", actualizado_cliente: "2027-06-01T10:00:00Z" }],
    ["fecha no ISO", id, { estado: "hecho", actualizado_cliente: "ayer" }],
    ["fecha sin zona", id, { estado: "hecho", actualizado_cliente: "2027-06-01T10:00:00" }],
    ["fecha numérica", id, { estado: "hecho", actualizado_cliente: 1780000000000 }],
    ["cuerpo no objeto", id, "hecho"],
    ["cuerpo nulo", id, null],
  ])("rechaza %s con un mensaje", (_n, elemento, cuerpo) => {
    const r = validarMarca(elemento, cuerpo, AHORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(10);
  });

  it("rechaza una fecha posterior a ahora + 24 h y acepta justo en el límite", () => {
    expect(validarMarca(id, { estado: "hecho", actualizado_cliente: "2027-06-02T12:00:01Z" }, AHORA).ok).toBe(false);
    expect(validarMarca(id, { estado: "hecho", actualizado_cliente: "2027-06-02T12:00:00Z" }, AHORA).ok).toBe(true);
  });

  it("invariante: solo acepta elementos del catálogo y los tres estados", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (elemento, estado) => {
        const r = validarMarca(elemento, { estado, actualizado_cliente: "2027-06-01T10:00:00Z" }, AHORA);
        expect(r.ok).toBe(IDS_PREPARATIVOS.has(elemento) && (ESTADOS_MARCA as readonly string[]).includes(estado));
      }),
    );
  });
});
