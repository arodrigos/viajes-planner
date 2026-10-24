import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "../tipos";

// tie-ac4: las dos rutas se prueban de verdad con la base, la sesión y el
// resto de lecturas dobladas; lo que se comprueba es que .ics y vista leen
// el perfil y el transporte del trabajo por el mismo camino.
const estado = vi.hoisted(() => ({ criterios: {} as Record<string, unknown>, plan: undefined as unknown }));

vi.mock("@/lib/auth/sesion", () => ({ requireSesion: async () => ({ usuarioId: "u", email: "u@example.com" }) }));
vi.mock("@/lib/db/cliente", () => ({ clienteServicio: () => ({}) }));
vi.mock("@/lib/plan/repositorio", async (original) => ({
  ...(await original<typeof import("../repositorio")>()),
  recuperarPlan: async () => estado.plan,
}));
vi.mock("@/lib/google/estados", () => ({ leerEstadosGoogle: async () => ({}), conEstadoGoogle: (p: unknown) => p }));
vi.mock("@/lib/plan/miembros", () => ({ contarMiembros: async () => 0 }));
vi.mock("@/lib/plan/propiedad", async (original) => {
  const real = await original<typeof import("../propiedad")>();
  return {
    ...real,
    rolEnPlan: async () => ({
      rol: "duenyo",
      trabajo: { id: "t", estado: "completado", regenerado_en: null, presupuesto_eur: null, intereses: null, perfil: (estado.criterios.perfil as string) ?? null, transporte: (estado.criterios.transporte as string[]) ?? null },
    }),
  };
});

import { GET as getIcs } from "@/app/api/plan/[id]/calendario.ics/route";
import { GET as getPlan } from "@/app/api/plan/[id]/route";

const plan = (): Plan =>
  ({
    id: "p",
    version: 1,
    destino: "Lisboa",
    personas: 3,
    dias: [
      {
        fecha: "2026-11-02",
        franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
        paradas: [
          { id: "a", franja_id: "manana", nombre: "A", descripcion: "", duracion_min: 90, prioridad: 50, procedencia: { fuente: "propuesto-sin-verificar" }, coordenadas: { lat: 40, lon: 0 } },
          { id: "b", franja_id: "manana", nombre: "B", descripcion: "", duracion_min: 60, prioridad: 50, procedencia: { fuente: "propuesto-sin-verificar" }, coordenadas: { lat: 40 + 1 / 111.195, lon: 0 } },
        ],
      },
    ],
  }) as Plan;

const ctx = { params: Promise.resolve({ id: "p" }) };
const peticion = (ruta: string) => new NextRequest(`http://localhost/api/plan/p${ruta}`);

async function iniciosDeB() {
  const publico = (await (await getPlan(peticion(""), ctx as never)).json()) as { dias: { paradas: { id: string; horario: { inicio: string } }[] }[] };
  const ics = await (await getIcs(peticion("/calendario.ics"), ctx as never)).text();
  const dtstartB = [...ics.matchAll(/^DTSTART[^:]*:\d{8}T(\d{4})/gm)][1][1];
  return { tarjeta: publico.dias[0].paradas[1].horario.inicio, ics: `${dtstartB.slice(0, 2)}:${dtstartB.slice(2)}` };
}

describe("coherencia .ics / vista del plan (tie-ac4)", () => {
  beforeEach(() => {
    estado.plan = plan();
  });

  it("cp-tie-04-ics-familiar: un viaje familiar da 10:55 en las dos", async () => {
    estado.criterios = { perfil: "familiar", transporte: ["transporte-publico"] };
    expect(await iniciosDeB()).toEqual({ tarjeta: "10:55", ics: "10:55" });
  });

  it("sin perfil las dos usan perfil null y dan 10:50", async () => {
    estado.criterios = {};
    expect(await iniciosDeB()).toEqual({ tarjeta: "10:50", ics: "10:50" });
  });
});
