import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// inf-ac1 (cp-inf-01): «Descargar infografía» entrega un PNG real de 1080×1350.
test.use({ viewport: { width: 390, height: 844 } });
const EMAIL = "ci-test-infografia-e2e@example.com";

test("Descargar infografía entrega un PNG de 1080×1350 y la ruta respeta la propiedad (inf-ac1)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: lista } = await supabase.auth.admin.listUsers();
  let usuarioId = lista?.users.find((u) => u.email === EMAIL)?.id;
  if (!usuarioId) {
    const { data, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
    if (error || !data.user) throw new Error(`No se pudo crear el usuario: ${error?.message}`);
    usuarioId = data.user.id;
  }

  const planId = `plan-infografia-e2e-${Date.now()}`;
  await supabase.from("planes").insert({ id: planId, destino: "Toledo" });
  const { data: version } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: "2027-03-05", franjas: franjasComoArray("Toledo") }], avisos: [] })
    .select("id")
    .single();
  const { data: procedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
  await supabase.from("paradas").insert({
    id_externo: "p-inf-0", plan_version_id: version?.id, dia_index: 0, franja_id: "manana", nombre: "Catedral de Toledo", descripcion: "Visita",
    duracion_min: 90, prioridad: 80, procedencia_id: procedencia?.id,
  });
  await supabase.from("trabajos").insert({ usuario_id: usuarioId, tipo: "generacion", criterios: { presupuesto_eur: 800 }, estado: "completado", plan_id: planId });

  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // El camino de descarga es el que se comprueba: sin navigator.share.
  await contexto.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
  const pagina = await contexto.newPage();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } })).ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } })).ok()).toBe(true);
  await pagina.goto(`/plan/${planId}`);
  await expect(pagina.getByRole("heading", { name: "Toledo" })).toBeVisible();
  await expect(pagina.getByText("Una imagen del viaje entero para guardar o compartir")).toBeVisible();

  const [descarga] = await Promise.all([pagina.waitForEvent("download"), pagina.getByRole("button", { name: "Descargar infografía" }).click()]);
  expect(descarga.suggestedFilename()).toMatch(/\.png$/);
  const bytes = readFileSync(await descarga.path());
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(bytes.readUInt32BE(16)).toBe(1080);
  expect(bytes.readUInt32BE(20)).toBe(1350);
  expect(bytes.length).toBeGreaterThan(20 * 1024);

  // Sin cookie: 401 sin Set-Cookie; id inexistente con sesión: 404.
  const sinCookie = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  const r401 = await sinCookie.request.get(`/api/plan/${planId}/infografia.png`);
  expect(r401.status()).toBe(401);
  expect(r401.headers()["set-cookie"]).toBeUndefined();
  await sinCookie.close();
  const conCookie = await contexto.request.get(`/api/plan/${planId}/infografia.png`);
  expect(conCookie.headers()["content-type"]).toBe("image/png");
  expect(conCookie.headers()["cache-control"]).toMatch(/private/);
  expect((await contexto.request.get("/api/plan/no-existe/infografia.png")).status()).toBe(404);
  await contexto.close();
});
