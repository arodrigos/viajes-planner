import { describe, expect, it } from "vitest";
import type { OperacionCola } from "@/lib/sinConexion/colaSalida";
import type { ElementoPreparativo } from "../tipos";
import { claveMarca, componerLista, progreso, sinSubir } from "../vista";

const el = (id: string): ElementoPreparativo => ({ id, categoria: "ninos", texto: id, porque: "x" });
const op = (elemento: string, estado: string, subida: OperacionCola["estado"] = "pendiente"): OperacionCola => ({
  clave: claveMarca("p1", elemento), ambito: "p1", tipo: "guardar", url: "u", cuerpo: { estado }, creada: "", intentos: 0, estado: subida, rev: 1,
});

describe("componerLista (lis-ac1/3)", () => {
  const elementos = [el("a"), el("b"), el("c")];
  it("sin marcas todo está pendiente y subido", () => {
    const l = componerLista(elementos, [], [], "p1");
    expect(l.map((e) => [e.estado, e.subida])).toEqual([["pendiente", "subida"], ["pendiente", "subida"], ["pendiente", "subida"]]);
  });
  it("lo encolado se pinta encima de lo del servidor y marca su estado de subida", () => {
    const l = componerLista(elementos, [{ elemento: "a", estado: "hecho", actualizado_cliente: "2027-01-01T00:00:00.000Z" }], [op("a", "pendiente"), op("b", "hecho", "sin-sesion")], "p1");
    expect(l[0]).toMatchObject({ estado: "pendiente", subida: "pendiente" });
    expect(l[1]).toMatchObject({ estado: "hecho", subida: "sin-sesion" });
    expect(sinSubir(l)).toBe(2);
  });
  it("ignora marcas de elementos que ya no están y operaciones de otro plan", () => {
    const otra = { ...op("a", "hecho"), clave: claveMarca("p2", "a") };
    const l = componerLista(elementos, [{ elemento: "zzz", estado: "hecho", actualizado_cliente: "x" }], [otra], "p1");
    expect(l).toHaveLength(3);
    expect(l.every((e) => e.estado === "pendiente")).toBe(true);
  });
  it("una rechazada se ve como rechazada", () => {
    expect(componerLista(elementos, [], [op("a", "hecho", "rechazada")], "p1")[0].subida).toBe("rechazada");
  });
});

describe("progreso", () => {
  it("«No me hace falta» no cuenta ni en listos ni en el total", () => {
    const l = componerLista([el("a"), el("b"), el("c")], [], [op("a", "hecho"), op("b", "no_hace_falta")], "p1");
    expect(progreso(l)).toEqual({ hechos: 1, total: 2 });
  });
});
