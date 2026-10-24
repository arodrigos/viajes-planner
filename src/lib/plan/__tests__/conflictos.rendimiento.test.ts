import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectarConflictosDia, type DiaConflictable } from "../conflictos";

// ape-ac5: un día de 9 paradas con horarios de todo tipo.
const REGLAS = ["Mo-Su 09:00-20:00", "Mo off; Tu-Su 10:00-18:00", "Mo-Fr 09:00-13:00,15:00-19:00", "Mo-Su 10:00-18:00 \"por cita\"", "24/7", "Su off; Mo-Sa 08:00-14:00", "Tu-Su 10:00-17:00", "Mo-Su 09:30-13:00", "abc"];
const dia: DiaConflictable = {
  fecha: "2026-11-16",
  franjas: [
    { id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" },
    { id: "tarde", etiqueta: "Tarde", hora_inicio: "15:00", hora_fin: "20:00" },
  ],
  paradas: REGLAS.map((r, i) => ({
    id: `p${i}`,
    franja_id: i < 4 ? "manana" : "tarde",
    duracion_min: 60,
    coordenadas: { lat: 41.9 + i * 0.002, lon: 12.5 + i * 0.002 },
    lugar: { etiquetas: { opening_hours: r } },
  })),
};
const opciones = { perfil: null };

describe("detectarConflictosDia: rendimiento (ape-ac5)", () => {
  it("recalcular con memoria caliente tarda menos de 50 ms", () => {
    detectarConflictosDia(dia, { opciones }); // fría: rellena la memoria
    const t0 = performance.now();
    detectarConflictosDia({ ...dia }, { opciones });
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("la primera evaluación con memoria fría es del orden de decenas de ms, no de segundos", () => {
    const fria = { ...dia, fecha: "2027-03-02" };
    const t0 = performance.now();
    detectarConflictosDia(fria, { opciones });
    // Cota holgada: la de 50 ms del diseño es para la recalculación; aquí solo se evita una regresión grosera.
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

// ape-ac5: opening_hours solo puede entrar al navegador por el import() diferido de PanelDia.
describe("opening_hours va en chunk aparte (ape-ac5)", () => {
  const raiz = join(__dirname, "../../..");
  const ficheros = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const r = join(d, n);
      if (statSync(r).isDirectory()) return n === "__tests__" ? [] : ficheros(r);
      return /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [r] : [];
    });

  it("la librería solo la importan apertura.ts y encaje.ts (servidor), y apertura.ts solo conflictos.ts", () => {
    const todos = ficheros(raiz);
    const lee = (f: string) => readFileSync(f, "utf8");
    const importaLibreria = todos.filter((f) => /from\s+["']opening_hours["']/.test(lee(f)));
    expect(importaLibreria.map((f) => f.slice(raiz.length + 1))).toEqual(["lib/alternativas/encaje.ts", "lib/plan/apertura.ts"]);
    const clientes = todos.filter((f) => /^["']use client["']/.test(lee(f)));
    expect(clientes.filter((f) => /alternativas\/encaje["']/.test(lee(f)))).toEqual([]);
    const importaApertura = todos.filter((f) => /from\s+["'](\.\/apertura|@\/lib\/plan\/apertura)["']/.test(lee(f)));
    expect(importaApertura.map((f) => f.slice(raiz.length + 1)).sort()).toEqual(["lib/plan/conflictos.ts"]);
  });

  it("los componentes del plan solo cargan conflictos.ts con import() dinámico", () => {
    const estaticos = ficheros(raiz).filter((f) => /^\s*import[^;]*from\s+["']@\/lib\/plan\/conflictos["']/m.test(readFileSync(f, "utf8")) && !/import type/.test(readFileSync(f, "utf8").match(/^\s*import[^;]*conflictos["']/m)?.[0] ?? ""));
    expect(estaticos.map((f) => f.slice(raiz.length + 1))).toEqual([]);
    expect(readFileSync(join(raiz, "app/plan/[id]/PanelDia.tsx"), "utf8")).toContain('import("@/lib/plan/conflictos")');
  });
});
