import { describe, expect, it } from "vitest";
import { entornoRestringido } from "@/lib/trabajador/entorno";

describe("entornoRestringido", () => {
  it("solo deja pasar la lista blanca, nunca secretos por nombre no listado", () => {
    const base = {
      PATH: "/usr/bin",
      HOME: "/home/trabajador",
      SUPABASE_SERVICE_ROLE_KEY: "secreto",
      OPENROUTESERVICE_API_KEY: "secreto",
      CRON_SECRET: "secreto",
      ALGO_INVENTADO: "no debería pasar tampoco",
    };

    const resultado = entornoRestringido(base);

    expect(resultado).toEqual({ PATH: "/usr/bin", HOME: "/home/trabajador" });
  });

  it("no falla si falta alguna de las variables permitidas", () => {
    expect(entornoRestringido({ PATH: "/usr/bin" })).toEqual({ PATH: "/usr/bin" });
  });
});
