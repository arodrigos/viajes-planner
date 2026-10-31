import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { idPlanProteccion, idsPorDia, limpiarPlanesProteccion, sembrarPlanEdicion, versionPersistida } from "@/test-utils/semilla-edicion";
import { peticion, usuarioDePrueba, type UsuarioDePrueba } from "@/test-utils/sesiones";
import { POST } from "../[...ruta]/route";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Entra por la ruta agrupada real, no por el fichero del endpoint: si la API se reorganiza
// y esta ruta deja de servirse, la prueba falla en vez de proteger un fichero muerto.
describe.skipIf(!SUPABASE_URL || !ANON_KEY)("orden de un día por la ruta agrupada (reg-ac1)", () => {
  const servicio = clienteDePrueba("servicio");
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

  const planes: string[] = [];
  async function plan() {
    const id = idPlanProteccion("orden");
    planes.push(id);
    await sembrarPlanEdicion(servicio, id, duenyo.usuarioId);
    return id;
  }
  const cuerpo = (version_base: number, ids: string[]) => ({ version_base, dia_index: 0, orden: ids.map((id) => ({ id, franja_id: "manana" })) });
  const enviar = (u: UsuarioDePrueba, id: string, c: unknown) => POST(peticion(`/api/plan/${id}/orden`, "POST", u.cookie, c));

  it("el dueño reordena y queda persistido; con versión desfasada no cambia nada; un ajeno recibe 404", async () => {
    const id = await plan();
    expect((await enviar(duenyo, id, cuerpo(1, ["p3", "p1", "p2"]))).status).toBe(200);
    expect(await idsPorDia(servicio, id)).toEqual([["p3", "p1", "p2"], ["q1"]]);
    expect(await versionPersistida(servicio, id)).toBe(2);

    const desfasada = await enviar(duenyo, id, cuerpo(1, ["p1", "p2", "p3"]));
    expect(desfasada.status).toBe(409);
    expect((await desfasada.json()).error).toBe("version-desfasada");
    expect(await idsPorDia(servicio, id)).toEqual([["p3", "p1", "p2"], ["q1"]]);

    expect((await enviar(ajeno, id, cuerpo(2, ["p1", "p2", "p3"]))).status).toBe(404);
    expect(await idsPorDia(servicio, id)).toEqual([["p3", "p1", "p2"], ["q1"]]);
    expect(await versionPersistida(servicio, id)).toBe(2);
  });

  it("un orden con un id que no es del día se rechaza sin cambiar el plan", async () => {
    const id = await plan();
    const r = await enviar(duenyo, id, cuerpo(1, ["p1", "p2", "q1"]));
    expect(r.status).toBe(400);
    expect(await idsPorDia(servicio, id)).toEqual([["p1", "p2", "p3"], ["q1"]]);
  });

  it("invariante: cualquier permutación se persiste tal cual, sin tocar los demás días", async () => {
    const id = await plan();
    let version = 1;
    await fc.assert(
      fc.asyncProperty(fc.shuffledSubarray(["p1", "p2", "p3"], { minLength: 3, maxLength: 3 }), async (permutacion) => {
        const r = await enviar(duenyo, id, cuerpo(version, permutacion));
        expect(r.status).toBe(200);
        version += 1;
        expect(await idsPorDia(servicio, id)).toEqual([permutacion, ["q1"]]);
      }),
      { numRuns: 6 },
    );
  });
});
