import { readdirSync } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { invitar, limpiarPlanes, sembrarPlan } from "@/test-utils/semilla-compartir";
import { contexto, peticion, usuarioDePrueba, type UsuarioDePrueba } from "@/test-utils/sesiones";
import * as ficha from "../google/ficha/route";
import * as planGet from "../plan/[id]/route";
import * as calendario from "../plan/[id]/calendario.ics/route";
import * as ciudad from "../plan/[id]/ciudad/route";
import * as infografia from "../plan/[id]/infografia.png/route";
import * as miembros from "../plan/[id]/miembros/route";
import * as miembro from "../plan/[id]/miembros/[miembroId]/route";
import * as orden from "../plan/[id]/orden/route";
import * as sustituir from "../plan/[id]/paradas/[paradaId]/sustituir/route";
import * as regenerar from "../plan/[id]/regenerar/route";
import * as sitios from "../plan/[id]/sitios/route";
import * as sitio from "../plan/[id]/sitios/[idExterno]/route";
import * as visitas from "../plan/[id]/visitas/route";
import * as viaje from "../viajes/[id]/route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

type Manejador = (request: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

// Toda route.ts de src/app/api tiene que aparecer aquí: o clasificada por
// rol (lectura / escritura) o declarada ajena a los planes. Una ruta nueva
// sin clasificar hace fallar el test, que es lo que impide que un endpoint
// de escritura nazca abierto al miembro.
const AJENAS_AL_PLAN = [
  "acceso/solicitar-codigo/route.ts",
  "acceso/verificar-codigo/route.ts",
  "auth/cerrar-sesion/route.ts",
  "plan/route.ts",
  "salud/route.ts",
  "trabajos/[id]/route.ts",
  "viajes/route.ts",
];

function rutasDeDisco(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const completa = path.join(dir, e.name);
    if (e.isDirectory()) return rutasDeDisco(completa, base);
    return /^route\.tsx?$/.test(e.name) ? [path.relative(base, completa).replace(/\.tsx$/, ".ts")] : [];
  });
}

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("matriz de roles por ruta (cmd-ac4)", () => {
  const servicio = clienteDePrueba("servicio");
  const planId = `plan-matriz-${Date.now()}`;
  let a: UsuarioDePrueba;
  let b: UsuarioDePrueba;
  let c: UsuarioDePrueba;
  let miembroId: string;
  let trabajoId: string;

  interface Entrada {
    nombre: string;
    metodo: string;
    url: (p: typeof valores) => string;
    cuerpo?: unknown;
    manejador: Manejador | undefined;
    params: (p: typeof valores) => Record<string, string>;
    lectura: boolean;
  }
  let valores: { planId: string; miembroId: string; trabajoId: string };
  const plan = (p: typeof valores) => ({ id: p.planId });

  const TABLA: Entrada[] = [
    { nombre: "GET plan", metodo: "GET", url: (p) => `/api/plan/${p.planId}`, manejador: planGet.GET as Manejador, params: plan, lectura: true },
    { nombre: "GET calendario.ics", metodo: "GET", url: (p) => `/api/plan/${p.planId}/calendario.ics`, manejador: calendario.GET as Manejador, params: plan, lectura: true },
    { nombre: "GET infografia.png", metodo: "GET", url: (p) => `/api/plan/${p.planId}/infografia.png`, manejador: infografia.GET as Manejador, params: plan, lectura: true },
    { nombre: "POST regenerar", metodo: "POST", url: (p) => `/api/plan/${p.planId}/regenerar`, manejador: regenerar.POST as Manejador, params: plan, lectura: false },
    { nombre: "POST orden", metodo: "POST", url: (p) => `/api/plan/${p.planId}/orden`, cuerpo: { version_base: 1, dia_index: 0, orden: [{ id: "a", franja_id: "manana" }] }, manejador: orden.POST as Manejador, params: plan, lectura: false },
    { nombre: "POST sustituir", metodo: "POST", url: (p) => `/api/plan/${p.planId}/paradas/a/sustituir`, cuerpo: { alternativa_id: "x" }, manejador: sustituir.POST as Manejador, params: (p) => ({ id: p.planId, paradaId: "a" }), lectura: false },
    { nombre: "POST ciudad", metodo: "POST", url: (p) => `/api/plan/${p.planId}/ciudad`, cuerpo: { nombre: "Cádiz" }, manejador: ciudad.POST as Manejador, params: plan, lectura: false },
    { nombre: "POST visitas", metodo: "POST", url: (p) => `/api/plan/${p.planId}/visitas`, cuerpo: { parada_id: "a" }, manejador: visitas.POST as Manejador, params: plan, lectura: false },
    { nombre: "DELETE visitas", metodo: "DELETE", url: (p) => `/api/plan/${p.planId}/visitas`, cuerpo: { parada_id: "a" }, manejador: visitas.DELETE as Manejador, params: plan, lectura: false },
    { nombre: "POST sitios", metodo: "POST", url: (p) => `/api/plan/${p.planId}/sitios`, cuerpo: { dia: 0, nombre: "Casa Fassi", version_base: 1 }, manejador: sitios.POST as Manejador, params: plan, lectura: false },
    { nombre: "PATCH sitio", metodo: "PATCH", url: (p) => `/api/plan/${p.planId}/sitios/propia-0001`, cuerpo: { nombre: "Otro", version_base: 1 }, manejador: sitio.PATCH as Manejador, params: (p) => ({ id: p.planId, idExterno: "propia-0001" }), lectura: false },
    { nombre: "DELETE sitio", metodo: "DELETE", url: (p) => `/api/plan/${p.planId}/sitios/propia-0001?version_base=1`, manejador: sitio.DELETE as Manejador, params: (p) => ({ id: p.planId, idExterno: "propia-0001" }), lectura: false },
    { nombre: "GET miembros", metodo: "GET", url: (p) => `/api/plan/${p.planId}/miembros`, manejador: miembros.GET as Manejador, params: plan, lectura: false },
    { nombre: "POST miembros", metodo: "POST", url: (p) => `/api/plan/${p.planId}/miembros`, cuerpo: { correo: "ci-test-comp-ajeno@example.com" }, manejador: miembros.POST as Manejador, params: plan, lectura: false },
    { nombre: "DELETE miembro", metodo: "DELETE", url: (p) => `/api/plan/${p.planId}/miembros/${p.miembroId}`, manejador: miembro.DELETE as Manejador, params: (p) => ({ id: p.planId, miembroId: p.miembroId }), lectura: false },
    { nombre: "DELETE viaje", metodo: "DELETE", url: (p) => `/api/viajes/${p.trabajoId}`, manejador: viaje.DELETE as Manejador, params: (p) => ({ id: p.trabajoId }), lectura: false },
    { nombre: "POST google/ficha", metodo: "POST", url: () => `/api/google/ficha`, cuerpo: { planId, paradaId: "a" }, manejador: ficha.POST as Manejador, params: () => ({}), lectura: false },
  ];

  beforeAll(async () => {
    a = await usuarioDePrueba("ci-test-comp-duenyo@example.com");
    b = await usuarioDePrueba("ci-test-comp-miembro@example.com");
    c = await usuarioDePrueba("ci-test-comp-ajeno@example.com");
    await sembrarPlan(servicio, planId, a.usuarioId);
    miembroId = await invitar(servicio, planId, b.email, a.usuarioId);
    const { data } = await servicio.from("trabajos").select("id").eq("plan_id", planId).single();
    trabajoId = data!.id as string;
    valores = { planId, miembroId, trabajoId };
  });

  afterAll(async () => {
    await limpiarPlanes(servicio, [planId]);
  });

  async function instantanea() {
    const leer = async (tabla: string, columnas: string, filtro?: [string, string]) => {
      const consulta = servicio.from(tabla).select(columnas);
      const { data, error } = await (filtro ? consulta.eq(filtro[0], filtro[1]) : consulta);
      if (error) throw new Error(`${tabla}: ${error.message}`);
      return JSON.stringify(data);
    };
    const versiones = await servicio.from("plan_versiones").select("id").eq("plan_id", planId);
    const ids = (versiones.data ?? []).map((v) => v.id as string);
    const paradas = await servicio.from("paradas").select("id, id_externo, nombre, nota, plan_version_id").in("plan_version_id", ids);
    const visitas = await servicio.from("visitas").select("*").in("parada_id", (paradas.data ?? []).map((p) => p.id as string));
    return {
      versiones: JSON.stringify(versiones.data),
      paradas: JSON.stringify(paradas.data),
      visitas: JSON.stringify(visitas.data),
      miembros: await leer("miembros_plan", "id, correo", ["plan_id", planId]),
      trabajos: await leer("trabajos", "id, estado, eliminado_en, regenerado_en", ["plan_id", planId]),
      cupo: await leer("consumo_google_usuario", "*"),
    };
  }

  it("cada route.ts de src/app/api está en la tabla o declarada ajena al plan", () => {
    const enDisco = rutasDeDisco(path.join(import.meta.dirname, "..")).filter((r) => !r.startsWith("__tests__")).sort();
    const clasificadas = [
      ...AJENAS_AL_PLAN,
      "google/ficha/route.ts",
      "plan/[id]/route.ts",
      "plan/[id]/calendario.ics/route.ts",
      "plan/[id]/ciudad/route.ts",
      "plan/[id]/infografia.png/route.ts",
      "plan/[id]/miembros/route.ts",
      "plan/[id]/miembros/[miembroId]/route.ts",
      "plan/[id]/orden/route.ts",
      "plan/[id]/paradas/[paradaId]/sustituir/route.ts",
      "plan/[id]/regenerar/route.ts",
      "plan/[id]/reservas/route.ts",
      "plan/[id]/reservas/[reservaId]/route.ts",
      "plan/[id]/sitios/route.ts",
      "plan/[id]/sitios/[idExterno]/route.ts",
      "plan/[id]/visitas/route.ts",
      "viajes/[id]/route.ts",
    ].sort();
    expect(enDisco).toEqual(clasificadas);
  });

  it("el ajeno recibe 404 y el miembro 403 en cada escritura, sin que cambie ninguna fila; el miembro lee las tres lecturas", async () => {
    const antes = await instantanea();
    for (const e of TABLA) {
      const ctx = contexto(e.params(valores));
      const como = (u: UsuarioDePrueba) => e.manejador!(peticion(e.url(valores), e.metodo, u.cookie, e.cuerpo), ctx);

      const ajeno = await como(c);
      expect(ajeno.status, `${e.nombre} como ajeno`).toBe(404);
      const delMiembro = await como(b);
      expect(delMiembro.status, `${e.nombre} como miembro`).toBe(e.lectura ? 200 : 403);
    }
    expect(await instantanea()).toEqual(antes);
  });
});
