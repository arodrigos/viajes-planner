import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";
import { urlComoLlegar } from "@/lib/plan/urlComoLlegar";

// dest-ac1/dest-ac2: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-destino@example.com";
const DESTINO = "Granada";
const RESUELTO_EN = new Date("2026-10-04").toISOString();

// dest-ac1: "hoy" es la fecha del DISPOSITIVO (zona local de quien corre el
// test, que en CI es la misma zona del navegador que Playwright lanza) --
// nunca una fecha fija, porque el criterio es justo "el día de hoy".
function fechaDeHoyISO(): string {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = String(hoy.getMonth() + 1).padStart(2, "0");
  const dia = String(hoy.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

const PARADA_A = { id: "p-destino-a", nombre: "Alhambra", lat: 37.1761, lon: -3.5881 };
const PARADA_B = { id: "p-destino-b", nombre: "Mirador de San Nicolás", lat: 37.1793, lon: -3.5903 };
const PARADA_SIN_COORDENADAS = { id: "p-destino-sin-ubicar", nombre: "Sitio Inventado Que No Existe" };

async function sembrarPlan(supabase: SupabaseClient, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);

  const franjas = franjasComoArray(DESTINO);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: fechaDeHoyISO(), franjas }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion?.message}`);

  async function sembrarParada(idExterno: string, nombre: string, franjaId: string, coordenadas: { lat: number; lon: number } | null) {
    if (!version) throw new Error("no se pudo sembrar la versión del plan");
    const { data: procedencia, error: errorProcedencia } = await supabase
      .from("procedencias")
      .insert({ fuente: "propuesto-sin-verificar" })
      .select("id")
      .single();
    if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);

    const { error: errorParada } = await supabase.from("paradas").insert({
      id_externo: idExterno,
      plan_version_id: version.id,
      dia_index: 0,
      franja_id: franjaId,
      nombre,
      descripcion: "Visita guiada",
      lat: coordenadas?.lat ?? null,
      lon: coordenadas?.lon ?? null,
      duracion_min: 90,
      prioridad: 60,
      procedencia_id: procedencia.id,
      lugar: coordenadas
        ? { fuente: "osm", id: `osm:way/${idExterno}`, url: `https://www.openstreetmap.org/way/${idExterno}`, nombre_fuente: nombre, etiquetas: {}, resuelto_en: RESUELTO_EN }
        : null,
      resolucion: coordenadas
        ? { estado: "resuelta", intentado_en: RESUELTO_EN }
        : { estado: "no-resuelta", intentado_en: RESUELTO_EN, motivo: "ningún candidato aceptable" },
    });
    if (errorParada) throw new Error(`No se pudo sembrar la parada '${idExterno}': ${errorParada.message}`);
  }

  await sembrarParada(PARADA_A.id, PARADA_A.nombre, "manana", { lat: PARADA_A.lat, lon: PARADA_A.lon });
  await sembrarParada(PARADA_B.id, PARADA_B.nombre, "comida", { lat: PARADA_B.lat, lon: PARADA_B.lon });
  await sembrarParada(PARADA_SIN_COORDENADAS.id, PARADA_SIN_COORDENADAS.nombre, "tarde", null);
}

async function iniciarSesion(contexto: import("@playwright/test").BrowserContext, email: string) {
  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(email);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);
}

test("marcar/desmarcar visitada, mapa centrado en la siguiente y «Cómo llegar» (dest-ac1, dest-ac2)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-destino-${Date.now()}`;
  await sembrarPlan(supabase, planId);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();
  await iniciarSesion(contexto, EMAIL);

  await pagina.goto(`/plan/${planId}?dia=1`);
  await expect(pagina.getByRole("heading", { name: DESTINO })).toBeVisible();

  // Aislado por plan: cuenta solo las visitas de las paradas de ESTE plan
  // (fullyParallel: true -- contar la tabla entera mezclaría visitas de
  // otros tests que corren a la vez).
  async function contarVisitas() {
    const { data: version, error: errorVersion } = await supabase.from("plan_versiones").select("id").eq("plan_id", planId).single();
    if (errorVersion || !version) throw new Error(`No se pudo leer la versión: ${errorVersion?.message}`);
    const { data: paradas, error: errorParadas } = await supabase.from("paradas").select("id").eq("plan_version_id", version.id);
    if (errorParadas) throw new Error(`No se pudieron leer las paradas: ${errorParadas.message}`);
    const idsParadas = (paradas ?? []).map((p) => p.id as string);
    if (idsParadas.length === 0) return 0;
    const { count } = await supabase.from("visitas").select("id", { count: "exact", head: true }).in("parada_id", idsParadas);
    return count ?? 0;
  }

  // dest-ac1: antes de marcar, 0 filas de visitas para este plan.
  expect(await contarVisitas()).toBe(0);

  const tarjetaA = pagina.locator(".tarjeta-parada", { hasText: PARADA_A.nombre });
  await tarjetaA.getByRole("button", { name: "Marcar como visitada" }).click();
  await expect(tarjetaA.getByRole("button", { name: "Visitada ✓" })).toBeVisible();
  expect(await contarVisitas()).toBe(1);

  // Tras recargar, sigue marcada.
  await pagina.reload();
  const tarjetaATrasRecargar = pagina.locator(".tarjeta-parada", { hasText: PARADA_A.nombre });
  await expect(tarjetaATrasRecargar.getByRole("button", { name: "Visitada ✓" })).toBeVisible();
  expect(await contarVisitas()).toBe(1);

  // dest-ac2: el marcador de la parada A queda visitada, y el mapa se
  // centra en la siguiente sin visitar (B).
  await expect(pagina.locator('.marcador-parada[data-parada-id="p-destino-a"]')).toHaveAttribute("data-estado", "visitada");
  await expect(pagina.locator(".contenedor-mapa-dia")).toHaveAttribute("data-centro-parada", "p-destino-b");

  // dest-ac2: «Cómo llegar» de A (última visitada) a B (siguiente).
  const hrefEsperado = urlComoLlegar({ lat: PARADA_A.lat, lon: PARADA_A.lon }, { lat: PARADA_B.lat, lon: PARADA_B.lon });
  const tarjetaB = pagina.locator(".tarjeta-parada", { hasText: PARADA_B.nombre });
  await expect(tarjetaB.getByRole("link", { name: "Cómo llegar" })).toHaveAttribute("href", hrefEsperado);

  // dest-ac3: la parada sin coordenadas se puede marcar como visitada, pero
  // no tiene «Cómo llegar» y lo explica.
  const tarjetaSinUbicar = pagina.locator(".tarjeta-parada", { hasText: PARADA_SIN_COORDENADAS.nombre });
  await expect(tarjetaSinUbicar.getByRole("link", { name: "Cómo llegar" })).toHaveCount(0);
  await expect(tarjetaSinUbicar.getByText("Sin ubicación comprobada")).toBeVisible();
  await tarjetaSinUbicar.getByRole("button", { name: "Marcar como visitada" }).click();
  await expect(tarjetaSinUbicar.getByRole("button", { name: "Visitada ✓" })).toBeVisible();

  // Desmarcar A: la fila desaparece.
  await tarjetaATrasRecargar.getByRole("button", { name: "Visitada ✓" }).click();
  await expect(tarjetaATrasRecargar.getByRole("button", { name: "Marcar como visitada" })).toBeVisible();
  expect(await contarVisitas()).toBe(1); // la de "sin ubicar" sigue en pie

  // dest-ac5: capturas claro/oscuro con una parada visitada.
  await tarjetaB.getByRole("button", { name: "Marcar como visitada" }).click();
  await expect(tarjetaB.getByRole("button", { name: "Visitada ✓" })).toBeVisible();
  await pagina.emulateMedia({ colorScheme: "light" });
  await pagina.screenshot({ path: "artefactos/capturas/plan-destino-claro.png" });
  await pagina.emulateMedia({ colorScheme: "dark" });
  await pagina.screenshot({ path: "artefactos/capturas/plan-destino-oscuro.png" });

  await contexto.close();
});

test("un día que no es hoy no muestra ningún botón de visita (dest-ac3)", async ({ browser }) => {
  const email = "ci-test-destino-no-hoy@example.com";
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);

  const planId = `plan-destino-futuro-${Date.now()}`;
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: DESTINO });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const franjas = franjasComoArray(DESTINO);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: "2099-01-01", franjas }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);
  const { data: procedencia, error: errorProcedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
  if (errorProcedencia || !procedencia) throw new Error(`No se pudo sembrar la procedencia: ${errorProcedencia?.message}`);
  const { error: errorParada } = await supabase.from("paradas").insert({
    id_externo: "p-futuro-a",
    plan_version_id: version.id,
    dia_index: 0,
    franja_id: "manana",
    nombre: PARADA_A.nombre,
    descripcion: "Visita guiada",
    lat: PARADA_A.lat,
    lon: PARADA_A.lon,
    duracion_min: 90,
    prioridad: 60,
    procedencia_id: procedencia.id,
    lugar: { fuente: "osm", id: "osm:way/futuro", url: "https://www.openstreetmap.org/way/futuro", nombre_fuente: PARADA_A.nombre, etiquetas: {}, resuelto_en: RESUELTO_EN },
    resolucion: { estado: "resuelta", intentado_en: RESUELTO_EN },
  });
  if (errorParada) throw new Error(`No se pudo sembrar la parada: ${errorParada.message}`);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: {}, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo de prueba: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();
  await iniciarSesion(contexto, email);
  await pagina.goto(`/plan/${planId}?dia=1`);
  await expect(pagina.getByRole("heading", { name: DESTINO })).toBeVisible();

  await expect(pagina.getByRole("button", { name: "Marcar como visitada" })).toHaveCount(0);
  await expect(pagina.getByRole("button", { name: "Visitada ✓" })).toHaveCount(0);

  await contexto.close();
});
