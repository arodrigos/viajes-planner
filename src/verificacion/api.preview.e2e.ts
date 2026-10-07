import { expect, request as playwrightRequest, test } from "@playwright/test";
import { leerPlan, pngDimensiones, FIRMA_PNG, type ParadaApi } from "./ayudas";
import { planDePrueba } from "./entorno";

test("pv-nps-02: la infografía exige sesión y no distingue plan ajeno de inexistente (cp-nps-02)", async ({ request, baseURL }) => {
  const id = planDePrueba();
  const conCookie = await request.get(`/api/plan/${id}/infografia.png`);
  expect(conCookie.status()).toBe(200);
  expect(conCookie.headers()["content-type"]).toBe("image/png");
  const bytes = await conCookie.body();
  const png = pngDimensiones(bytes);
  expect(png.firma).toEqual(FIRMA_PNG);
  expect([png.ancho, png.alto]).toEqual([1080, 1350]);
  expect(bytes.length).toBeGreaterThan(20 * 1024);

  // Sin la sesión de la app pero con la de Vercel: lo que responde es la app,
  // no la protección del preview. Se quita solo la cookie de la app.
  const cookies = (await request.storageState()).cookies.filter((c) => c.name.startsWith("_vercel"));
  const sinSesion = await playwrightRequest.newContext({ baseURL, storageState: { cookies, origins: [] } });
  const r401 = await sinSesion.get(`/api/plan/${id}/infografia.png`);
  expect(r401.status()).toBe(401);
  expect(r401.headers()["set-cookie"]).toBeUndefined();
  await sinSesion.dispose();

  const noExiste = await request.get("/api/plan/no-existe/infografia.png");
  const ajeno = await request.get("/api/plan/00000000-0000-4000-8000-000000000000/infografia.png");
  expect(noExiste.status()).toBe(404);
  expect(ajeno.status()).toBe(404);
  expect((await ajeno.body()).equals(await noExiste.body())).toBe(true);
});

// Lo que decide la identidad de una parada para el juicio: se descartan los
// ids, que cambian con cada versión del plan.
function contenido(p: ParadaApi) {
  return { nombre: p.nombre, coordenadas: p.coordenadas, guia: p.guia, curiosidades: p.curiosidades, motivo: p.motivo, coste: p.coste };
}

test("pv-alg-01: sustituir una parada y deshacerlo deja el plan como estaba (cp-alg-01)", async ({ request }) => {
  const id = planDePrueba();
  const antes = await leerPlan(request);
  const original = antes.dias.flatMap((d) => d.paradas).find((p) => (p.alternativas?.length ?? 0) > 0 && p.alternativas?.[0].id);
  expect(original, "el plan de prueba no tiene ninguna parada con alternativas: el caso no se puede juzgar").toBeDefined();
  const parada = original!;
  const guardado = antes.dias.flatMap((d) => d.paradas).map(contenido);

  const sustituir = await request.post(`/api/plan/${id}/paradas/${parada.id}/sustituir`, { data: { alternativa_id: parada.alternativas![0].id } });
  expect(sustituir.ok()).toBe(true);

  const intermedio = (await leerPlan(request)).dias.flatMap((d) => d.paradas).find((p) => p.id === parada.id)!;
  expect(intermedio.nombre).toBe(parada.alternativas![0].nombre);
  // Heredaba la guía de la alternativa, no el motivo ni el coste de la sustituida.
  if (parada.motivo) expect(intermedio.motivo).not.toBe(parada.motivo);

  const vuelta = intermedio.alternativas?.find((a) => a.nombre === parada.nombre);
  expect(vuelta?.id, "la parada sustituida no está entre las alternativas de la nueva: no se puede volver").toBeTruthy();
  const deshacer = await request.post(`/api/plan/${id}/paradas/${parada.id}/sustituir`, { data: { alternativa_id: vuelta!.id } });
  expect(deshacer.ok()).toBe(true);

  const despues = (await leerPlan(request)).dias.flatMap((d) => d.paradas).map(contenido);
  expect(despues).toEqual(guardado);
});
