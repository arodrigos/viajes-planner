import { expect, test, type Locator } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { extraerBloque, leerToken } from "@/lib/css/leerTokenCss";
import { medirObjetivosTactiles } from "@/lib/testing/medirObjetivosTactiles";

// peso-ac1/ac2/ac5/ac6/ac7: viewport móvil real declarado por el diseño.
test.use({ viewport: { width: 393, height: 851 } });

const EMAIL = "ci-test-peso-visual@example.com";
const EMAIL_VACIO = "ci-test-peso-visual-vacio@example.com";
const DESTINO_COMPLETADO = "Alicante";
const DESTINO_ENCOLADO = "Girona";

// import.meta.dirname no está disponible bajo el transform de Playwright
// (a diferencia de vitest, que sí lo soporta en contraste-peligro.test.ts);
// process.cwd() es la raíz del repo, desde donde siempre se lanza `playwright test`.
const RUTA_CSS = join(process.cwd(), "src", "app", "globals.css");

// Siembra directa con la clave de servicio (server-only, mismo motivo ya
// documentado en mis-viajes.movil.e2e.ts y eliminar.movil.e2e.ts): un plan
// mínimo basta, lo que prueba este bloque es el peso visual, no el plan.
async function sembrarPlanMinimo(supabase: SupabaseClient, planId: string, destino: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [], avisos: [] });
  if (errorVersion) throw new Error(`No se pudo sembrar la versión del plan: ${errorVersion.message}`);
}

function hexARgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

async function estilosDe(locator: Locator) {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { backgroundColor: cs.backgroundColor, borderColor: cs.borderColor, color: cs.color, fontWeight: cs.fontWeight };
  });
}

const PROPIEDADES = ["backgroundColor", "borderColor", "color", "fontWeight"] as const;

test("peso-visual: la acción principal pesa más que «Eliminar», y en el diálogo «Eliminar de verdad» se lee como irreversible (peso-ac1/ac2/ac5/ac6/ac7)", async ({
  browser,
}) => {
  const supabase = clienteDePrueba("servicio");
  const marca = Date.now();
  const planId = `plan-peso-visual-${marca}`;

  const { data: usuario, error: errorUsuario } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (errorUsuario || !usuario.user) throw new Error(`No se pudo crear el usuario: ${errorUsuario?.message}`);

  await sembrarPlanMinimo(supabase, planId, DESTINO_COMPLETADO);
  const { error: errorCompletado } = await supabase.from("trabajos").insert({
    usuario_id: usuario.user.id,
    tipo: "generacion",
    criterios: { destino_o_tipo: DESTINO_COMPLETADO },
    estado: "completado",
    plan_id: planId,
  });
  if (errorCompletado) throw new Error(`No se pudo sembrar el trabajo completado: ${errorCompletado.message}`);

  // Segundo viaje SIN completar, para que "Ver el progreso" (la otra
  // variante del enlace principal, peso-ac1) también entre en la comparación.
  const { error: errorEncolado } = await supabase.from("trabajos").insert({
    usuario_id: usuario.user.id,
    tipo: "generacion",
    criterios: { destino_o_tipo: DESTINO_ENCOLADO },
    estado: "encolado",
  });
  if (errorEncolado) throw new Error(`No se pudo sembrar el trabajo encolado: ${errorEncolado.message}`);

  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();

  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);

  await pagina.goto("/viajes");
  await expect(pagina.getByText(DESTINO_COMPLETADO)).toBeVisible();
  await expect(pagina.getByText(DESTINO_ENCOLADO)).toBeVisible();

  // Literales reales de globals.css, nunca copiados a mano (mismo método
  // que contraste-peligro.test.ts, vía src/lib/css/leerTokenCss.ts).
  const css = readFileSync(RUTA_CSS, "utf8");
  const bloqueClaro = extraerBloque(css, /:root\s*\{/);
  const bloqueOscuro = extraerBloque(css, /prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?:root\s*\{/);

  const tarjetaCompletado = pagina.locator("li").filter({ hasText: DESTINO_COMPLETADO });
  const tarjetaEncolada = pagina.locator("li").filter({ hasText: DESTINO_ENCOLADO });

  for (const [modo, bloque] of [
    ["claro", bloqueClaro],
    ["oscuro", bloqueOscuro],
  ] as const) {
    await pagina.emulateMedia({ colorScheme: modo === "claro" ? "light" : "dark" });

    const peligroBorde = hexARgb(leerToken(bloque, "peligro-borde"));
    const peligroFondo = hexARgb(leerToken(bloque, "peligro-fondo"));
    const peligroTexto = hexARgb(leerToken(bloque, "peligro-texto"));

    // peso-ac1: en cada tarjeta, el enlace principal pesa más que «Eliminar»
    // -comparados sus estilos COMPUTADOS, nunca una lista de valores escritos
    // a mano-, y «Eliminar» resuelve al color de peligro real.
    for (const [tarjeta, textoEnlace] of [
      [tarjetaCompletado, "Ver el itinerario"],
      [tarjetaEncolada, "Ver el progreso"],
    ] as const) {
      const enlace = tarjeta.getByRole("link", { name: textoEnlace });
      const boton = tarjeta.getByRole("button", { name: "Eliminar" });
      const [estiloEnlace, estiloBoton] = await Promise.all([estilosDe(enlace), estilosDe(boton)]);
      const diferencias = PROPIEDADES.filter((propiedad) => estiloEnlace[propiedad] !== estiloBoton[propiedad]);
      expect(
        diferencias.length,
        `${modo}/${textoEnlace}: estilos computados de enlace vs Eliminar (difieren en: ${diferencias.join(", ") || "nada"})`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        estiloBoton.color === peligroBorde || estiloBoton.borderColor === peligroBorde,
        `${modo}/${textoEnlace}: Eliminar debe resolver al color de peligro de globals.css`,
      ).toBe(true);
    }

    // peso-ac2: dentro del diálogo, «Cancelar» y «Eliminar de verdad» ya no
    // comparten el mismo estilo computado.
    await tarjetaCompletado.getByRole("button", { name: "Eliminar" }).click();
    const dialogo = pagina.getByRole("alertdialog", { name: new RegExp(DESTINO_COMPLETADO) });
    await expect(dialogo).toBeVisible();
    const cancelar = dialogo.getByRole("button", { name: "Cancelar" });
    const eliminarDeVerdad = dialogo.getByRole("button", { name: "Eliminar de verdad" });
    await expect(cancelar).toBeFocused();

    const [estiloCancelar, estiloEliminarDeVerdad] = await Promise.all([estilosDe(cancelar), estilosDe(eliminarDeVerdad)]);
    expect(estiloCancelar.color, `${modo}: Cancelar y Eliminar de verdad ya no deben compartir color`).not.toBe(estiloEliminarDeVerdad.color);
    expect(
      estiloCancelar.backgroundColor !== estiloEliminarDeVerdad.backgroundColor || estiloCancelar.borderColor !== estiloEliminarDeVerdad.borderColor,
      `${modo}: Cancelar y Eliminar de verdad deben diferir en fondo o en borde`,
    ).toBe(true);
    expect(estiloEliminarDeVerdad.backgroundColor, `${modo}: Eliminar de verdad debe resolver al fondo de peligro`).toBe(peligroFondo);
    expect(estiloEliminarDeVerdad.color, `${modo}: Eliminar de verdad debe resolver al texto de peligro`).toBe(peligroTexto);
    expect(estiloEliminarDeVerdad.borderColor, `${modo}: Eliminar de verdad debe resolver al borde de peligro`).toBe(peligroBorde);
    expect(estiloCancelar.color, `${modo}: Cancelar no debe llevar la marca de peligro`).not.toBe(peligroTexto);
    expect(estiloCancelar.borderColor, `${modo}: Cancelar no debe llevar la marca de peligro`).not.toBe(peligroBorde);

    // peso-ac7: el texto del diálogo sigue nombrando el destino y diciendo
    // que no se puede deshacer, y sigue sin prometer papelera ni recuperación.
    const textoDialogo = (await dialogo.innerText()).toLowerCase();
    expect(textoDialogo).toContain(DESTINO_COMPLETADO.toLowerCase());
    expect(textoDialogo).toMatch(/no se puede deshacer/);
    expect(textoDialogo).not.toMatch(/papelera/);
    expect(textoDialogo).not.toMatch(/recuperar/);

    // peso-ac5: captura real del diálogo de borrado ABIERTO, en este modo.
    await pagina.screenshot({ path: `artefactos/capturas/borrado-dialogo-${modo}.png`, fullPage: true });

    await cancelar.click();
    await expect(dialogo).toHaveCount(0);
  }
  await pagina.emulateMedia({ colorScheme: "light" });

  // peso-ac6: objetivo táctil >=44px y sin desbordamiento horizontal, con el
  // diálogo abierto y cerrado, a 393px y a 320px -misma técnica que
  // visual.movil.e2e.ts (visual-ac2), reutilizada vía
  // src/lib/testing/medirObjetivosTactiles.ts, no reimplementada.
  for (const ancho of [393, 320]) {
    await pagina.setViewportSize({ width: ancho, height: 851 });

    for (const dialogoAbierto of [false, true]) {
      if (dialogoAbierto) {
        await tarjetaCompletado.getByRole("button", { name: "Eliminar" }).click();
        await expect(pagina.getByRole("alertdialog")).toBeVisible();
      }

      const anchoDocumento = await pagina.evaluate(() => document.documentElement.scrollWidth);
      expect(
        anchoDocumento,
        `desbordamiento horizontal en /viajes a ${ancho}px (diálogo ${dialogoAbierto ? "abierto" : "cerrado"})`,
      ).toBeLessThanOrEqual(ancho);

      const elementos = await medirObjetivosTactiles(pagina);
      for (const el of elementos) {
        expect.soft(el.alto, `${el.descripcion} a ${ancho}px (diálogo ${dialogoAbierto ? "abierto" : "cerrado"}): alto`).toBeGreaterThanOrEqual(44);
        if (el.exigirAncho) {
          expect
            .soft(el.ancho, `${el.descripcion} a ${ancho}px (diálogo ${dialogoAbierto ? "abierto" : "cerrado"}): ancho`)
            .toBeGreaterThanOrEqual(44);
        }
      }

      if (dialogoAbierto) {
        await pagina.getByRole("alertdialog").getByRole("button", { name: "Cancelar" }).click();
        await expect(pagina.getByRole("alertdialog")).toHaveCount(0);
      }
    }
  }

  await contexto.close();
});

// peso-ac7/otro-ac3: el estado vacío se sigue viendo con una cuenta sin
// viajes, y sigue sin duplicar el camino a /criterios: solo el enlace de
// siempre («Cuéntanos tu viaje»), nunca también «Pedir otro viaje».
test("peso-visual: el estado vacío se sigue mostrando con una cuenta sin viajes, con un solo camino a /criterios (peso-ac7, otro-ac3)", async ({
  browser,
}) => {
  const contexto = await browser.newContext({ viewport: { width: 393, height: 851 } });
  const pagina = await contexto.newPage();

  const respuestaSolicitud = await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL_VACIO } });
  expect(respuestaSolicitud.ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL_VACIO);
  const respuestaVerificar = await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL_VACIO, codigo } });
  expect(respuestaVerificar.ok()).toBe(true);

  await pagina.goto("/viajes");
  await expect(pagina.getByText("Todavía no has pedido ningún viaje.")).toBeVisible();

  const enlacesACriterios = await pagina.locator('a[href="/criterios"]').count();
  expect(enlacesACriterios, "otro-ac3: exactamente un enlace a /criterios en el estado vacío").toBe(1);

  await contexto.close();
});

// peso-ac7: el mensaje de error de borrado sigue diciendo la verdad, sin
// prometer papelera ni recuperación -mocked, mismo patrón que la prueba de
// viajes-ac4 de mis-viajes.movil.e2e.ts: lo que se comprueba es la reacción
// del panel ante una respuesta que falla, no quién la sirve.
test("peso-visual: el mensaje de error de borrado no promete papelera ni recuperación (peso-ac7)", async ({ page }) => {
  await page.route("**/api/viajes", (route) =>
    route.fulfill({
      json: {
        correo: "mock@example.com",
        viajes: [{ id: "v-mock", destino: "Cuenca", fecha: "2026-11-01", estado: "completado", plan_id: "plan-mock" }],
      },
    }),
  );
  await page.route("**/api/viajes/v-mock", (route) => route.fulfill({ status: 500, json: { error: "fallo forzado" } }));

  await page.goto("/viajes");
  await expect(page.getByText("Cuenca")).toBeVisible();
  await page.getByRole("button", { name: "Eliminar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Eliminar de verdad" }).click();

  const aviso = page.getByRole("alert").filter({ hasText: /no se ha podido eliminar/i });
  await expect(aviso).toBeVisible();
  const texto = ((await aviso.textContent()) ?? "").toLowerCase();
  expect(texto).not.toMatch(/papelera/);
  expect(texto).not.toMatch(/recuperar/);
});
