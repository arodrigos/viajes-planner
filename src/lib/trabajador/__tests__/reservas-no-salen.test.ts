import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");

function fuentes(carpeta: string): string[] {
  return readdirSync(join(RAIZ, carpeta), { withFileTypes: true }).filter((e) => e.isFile() && /\.tsx?$/.test(e.name)).map((e) => join(RAIZ, carpeta, e.name));
}

// imp-ac8: el nombre, el origen, el localizador y las notas de una reserva
// (a veces importados de un .ics ajeno) son privados. Ni el prompt del
// trabajador ni los clientes de lugares y de Google leen la tabla ni el tipo de
// las reservas: si alguien empieza a hacerlo, este test avisa antes de que el
// texto llegue a un modelo o a una API externa.
describe("el texto de las reservas no sale (imp-ac8)", () => {
  it("ningún módulo del trabajador, de lugares ni de Google importa o consulta reservas", () => {
    const sospechosos: string[] = [];
    for (const f of [...fuentes("trabajador"), ...fuentes("lugares"), ...fuentes("google")]) {
      const texto = readFileSync(f, "utf8");
      if (/lib\/reservas|from\(\s*["']reservas["']\s*\)|\b(ReservaEntrada|ReservaPublica|TipoReserva)\b/.test(texto)) sospechosos.push(f);
    }
    expect(sospechosos).toEqual([]);
  });
});
