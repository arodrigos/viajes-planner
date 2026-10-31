import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { idPlanProteccion, idsPorDia, limpiarPlanesProteccion, sembrarPlanEdicion } from "@/test-utils/semilla-edicion";
import { peticion, usuarioDePrueba, type UsuarioDePrueba } from "@/test-utils/sesiones";
import { POST } from "../[...ruta]/route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

describe.skipIf(!SUPABASE_URL || !ANON_KEY)("mover una parada de día por la ruta agrupada (reg-ac2)", () => {
  const servicio = clienteDePrueba("servicio");
  const planes: string[] = [];
  let duenyo: UsuarioDePrueba;
  let ajeno: UsuarioDePrueba;

  beforeAll(async () => {
    await limpiarPlanesProteccion(servicio);
    duenyo = await usuarioDePrueba("ci-test-prot-duenyo@example.com");
    ajeno = await usuarioDePrueba("ci-test-prot-ajeno@example.com");
  });
  afterAll(async () => {
    await limpiarPlanesProteccion(servicio, planes);
  });

  async function plan() {
    const id = idPlanProteccion("mover-dia");
    planes.push(id);
    await sembrarPlanEdicion(servicio, id, duenyo.usuarioId);
    return id;
  }
  const mover = (u: UsuarioDePrueba, id: string, paradaId: string, c: unknown) =>
    POST(peticion(`/api/plan/${id}/paradas/${paradaId}/mover-dia`, "POST", u.cookie, c));
  const AL_DIA_2 = { version_base: 1, dia_origen: 0, dia_destino: 1, franja_id: "manana" };

  it("el dueño la lleva al día 2 sin duplicados; un ajeno recibe 404 y el plan no cambia", async () => {
    const id = await plan();
    expect((await mover(duenyo, id, "p2", AL_DIA_2)).status).toBe(200);
    const tras = await idsPorDia(servicio, id);
    expect(tras[0]).toEqual(["p1", "p3"]);
    expect([...tras[1]].sort()).toEqual(["p2", "q1"]);
    expect(tras.flat()).toHaveLength(4);

    expect((await mover(ajeno, id, "p1", { ...AL_DIA_2, version_base: 2 })).status).toBe(404);
    expect(await idsPorDia(servicio, id)).toEqual(tras);
  });

  it("un día destino inexistente se rechaza sin cambios", async () => {
    const id = await plan();
    const r = await mover(duenyo, id, "p2", { ...AL_DIA_2, dia_destino: 7 });
    expect(r.status).toBe(400);
    expect(await idsPorDia(servicio, id)).toEqual([["p1", "p2", "p3"], ["q1"]]);
  });
});
