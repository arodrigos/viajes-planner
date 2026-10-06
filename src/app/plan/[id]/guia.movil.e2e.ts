import { expect, test } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerCodigo } from "@/lib/auth/__tests__/mailpit";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { franjasComoArray } from "@/lib/plan/config-franjas";

// gui-ac1 (cp-gui-01) y gui-ac2: guía con atribución y enlace, precio de la
// fuente en lugar del estimado, curiosidades y los estados vacíos, en 360×740.
test.use({ viewport: { width: 360, height: 740 } });

const EMAIL = "ci-test-guia@example.com";
const FECHA = "2026-11-07";

async function sembrar(supabase: SupabaseClient, usuarioId: string, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Lisboa" });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { data: version, error: errorVersion } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: FECHA, franjas: franjasComoArray("Lisboa") }], avisos: [] })
    .select("id")
    .single();
  if (errorVersion || !version) throw new Error(`No se pudo sembrar la versión: ${errorVersion?.message}`);
  const { data: procedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
  if (!procedencia) throw new Error("No se pudo sembrar la procedencia");

  const base = { plan_version_id: version.id, dia_index: 0, franja_id: "manana", descripcion: "Visita", duracion_min: 60, prioridad: 80, procedencia_id: procedencia.id };
  const filas = [
    {
      ...base,
      id_externo: "g-jeronimos",
      nombre: "Monasterio de los Jerónimos",
      coste: { importe_eur: 10, por: "persona", procedencia: "wikivoyage", fecha: "2026-10-05" },
      guia: {
        consejo: "Gótico manuelino; entra temprano para evitar la cola.",
        precio_texto: "€10, under 12 free",
        precio_eur: 10,
        url: "https://en.wikivoyage.org/wiki/Lisbon/Bel%C3%A9m",
        licencia: "CC BY-SA",
      },
      curiosidades: { frases: ["El palacio original se edificó en la Alta Edad Media."], url: "https://es.wikipedia.org/wiki/Monasterio_de_los_Jer%C3%B3nimos" },
      guia_intentada_en: "2026-10-05T10:00:00Z",
    },
    {
      ...base,
      id_externo: "g-domingo",
      nombre: "Museo gratis en domingo",
      coste: { importe_eur: 8, por: "persona", procedencia: "estimado", fecha: "2026-10-05" },
      guia: { consejo: "Gratis los domingos por la mañana.", precio_texto: "free on Sundays", url: "https://en.wikivoyage.org/wiki/Lisbon", licencia: "CC BY-SA" },
      guia_intentada_en: "2026-10-05T10:00:00Z",
    },
    {
      ...base,
      id_externo: "g-sin-ficha",
      nombre: "Pastelería del barrio",
      coste: { importe_eur: 5, por: "persona", procedencia: "estimado", fecha: "2026-10-05" },
      guia_intentada_en: "2026-10-05T10:00:00Z",
    },
  ];
  for (const fila of filas) {
    const { error } = await supabase.from("paradas").insert(fila);
    if (error) throw new Error(`No se pudo sembrar '${fila.id_externo}': ${error.message}`);
  }
  const { error } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: { perfil: "familiar", presupuesto_eur: 900 }, estado: "completado", plan_id: planId });
  if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);
}

const ULTIMA_FRASE = "Última frase del consejo largo.";

// cc-ac2 (cp-cc-02): A con un consejo de 900 caracteres que acaba en ULTIMA_FRASE; B con uno de 120.
async function sembrarConsejos(supabase: SupabaseClient, usuarioId: string, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Lisboa" });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { data: version } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: FECHA, franjas: franjasComoArray("Lisboa") }], avisos: [] })
    .select("id")
    .single();
  const { data: procedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
  if (!version || !procedencia) throw new Error("No se pudo sembrar la versión");
  const relleno = "Texto de relleno del consejo que se repite para alargarlo. ";
  const largo = `${relleno.repeat(20)}`.slice(0, 900 - ULTIMA_FRASE.length - 1) + ` ${ULTIMA_FRASE}`;
  const corto = "Consejo corto de unas pocas palabras, que cabe entero sin necesidad de botón alguno.".padEnd(120, " ").trim();
  const base = { plan_version_id: version.id, dia_index: 0, franja_id: "manana", descripcion: "Visita", duracion_min: 60, prioridad: 80, procedencia_id: procedencia.id };
  const guia = (consejo: string) => ({ consejo, url: "https://en.wikivoyage.org/wiki/Lisbon", licencia: "CC BY-SA" });
  for (const fila of [
    { ...base, id_externo: "c-largo", nombre: "Parada consejo largo", guia: guia(largo), guia_intentada_en: "2026-10-05T10:00:00Z", guia_formato: 2 },
    { ...base, id_externo: "c-corto", nombre: "Parada consejo corto", guia: guia(corto), guia_intentada_en: "2026-10-05T10:00:00Z", guia_formato: 2 },
  ]) {
    const { error } = await supabase.from("paradas").insert(fila);
    if (error) throw new Error(`No se pudo sembrar '${fila.id_externo}': ${error.message}`);
  }
  const { error } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuarioId, tipo: "generacion", criterios: { perfil: "familiar", presupuesto_eur: 900 }, estado: "completado", plan_id: planId });
  if (error) throw new Error(`No se pudo sembrar el trabajo: ${error.message}`);
}

test("cp-cc-02: «Ver más» despliega el consejo largo y el corto no tiene botón (cc-ac2)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-guia-consejo@example.com";
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-guia-consejo-${Date.now()}`;
  await sembrarConsejos(supabase, usuario.user.id, planId);

  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } })).ok()).toBe(true);
  const codigo = await leerCodigo(email);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } })).ok()).toBe(true);

  await pagina.goto(`/plan/${planId}?dia=1`);
  const tarjetaA = pagina.locator("li.tarjeta-parada", { hasText: "Parada consejo largo" });
  const tarjetaB = pagina.locator("li.tarjeta-parada", { hasText: "Parada consejo corto" });
  const parrafoA = tarjetaA.getByTestId("consejo-guia");
  const botonA = tarjetaA.getByRole("button", { name: "Ver más" });
  // tar-ac1: los consejos viven en un panel plegado; hay que abrirlo para verlos.
  await tarjetaA.locator("summary", { hasText: /^Consejos y curiosidades/ }).click();
  await tarjetaB.locator("summary", { hasText: /^Consejos y curiosidades/ }).click();
  const altoYLinea = () => parrafoA.evaluate((el) => ({ alto: el.getBoundingClientRect().height, linea: parseFloat(getComputedStyle(el).lineHeight) }));

  await expect(botonA).toHaveAttribute("aria-expanded", "false");
  // El texto completo está en el DOM aunque se vea recortado.
  expect(await parrafoA.evaluate((el) => el.textContent)).toContain(ULTIMA_FRASE);
  const plegado = await altoYLinea();
  expect(plegado.alto).toBeLessThanOrEqual(plegado.linea * 4 + 1);

  await botonA.click();
  const botonAbierto = tarjetaA.getByRole("button", { name: "Ver menos" });
  await expect(botonAbierto).toHaveAttribute("aria-expanded", "true");
  await parrafoA.scrollIntoViewIfNeeded();
  await expect(parrafoA).toContainText(ULTIMA_FRASE);
  await expect(parrafoA).toBeInViewport();
  const desplegado = await altoYLinea();
  expect(desplegado.alto).toBeGreaterThan(desplegado.linea * 4);

  await expect(tarjetaB.getByRole("button", { name: /Ver m[aá]s/ })).toHaveCount(0);
  await expect(tarjetaB.getByTestId("consejo-guia")).toBeVisible();
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await contexto.close();
});

test("guía con atribución, precio de la fuente y estados vacíos (gui-ac1, gui-ac2)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-guia-${Date.now()}`;
  await sembrar(supabase, usuario.user.id, planId);

  const contexto = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const pagina = await contexto.newPage();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email: EMAIL } })).ok()).toBe(true);
  const codigo = await leerCodigo(EMAIL);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email: EMAIL, codigo } })).ok()).toBe(true);

  await pagina.goto(`/plan/${planId}?dia=1`);
  const jeronimos = pagina.locator("li.tarjeta-parada", { hasText: "Monasterio de los Jerónimos" });
  await expect(jeronimos.getByTestId("guia-parada")).toContainText("Consejos de la guía");
  await expect(jeronimos.getByTestId("guia-parada")).toContainText("Wikivoyage · CC BY-SA");
  const enlace = jeronimos.getByRole("link", { name: "Ver en Wikivoyage: Monasterio de los Jerónimos" });
  await expect(enlace).toHaveAttribute("href", "https://en.wikivoyage.org/wiki/Lisbon/Bel%C3%A9m");
  await expect(jeronimos.getByTestId("precio-parada")).toHaveText("Precio orientativo: 10\u00a0€/persona · según Wikivoyage");
  await expect(jeronimos.getByTestId("curiosidades-parada")).toContainText("El palacio original se edificó en la Alta Edad Media.");
  await expect(jeronimos.getByTestId("curiosidades-parada")).toContainText("Wikipedia · CC BY-SA");
  await expect(jeronimos.getByTestId("opiniones-parada")).toHaveText("Opiniones de visitantes: Sin opiniones de visitantes");

  // Precio no numérico: se enseña literal y el estimado se conserva.
  const domingo = pagina.locator("li.tarjeta-parada", { hasText: "Museo gratis en domingo" });
  await expect(domingo.getByTestId("guia-parada")).toContainText("Precio según la guía: free on Sundays");
  await expect(domingo.getByTestId("precio-parada")).toHaveText("Precio orientativo: 8\u00a0€/persona · estimado");

  const sinFicha = pagina.locator("li.tarjeta-parada", { hasText: "Pastelería del barrio" });
  await expect(sinFicha.getByTestId("guia-parada")).toContainText("La guía no tiene ficha de este sitio");
  await expect(sinFicha.getByTestId("curiosidades-parada")).toContainText("No hay curiosidades en Wikipedia para este sitio");
  await expect(sinFicha.getByTestId("precio-parada")).toHaveText("Precio orientativo: 5\u00a0€/persona · estimado");
  await expect(pagina.getByTestId("opiniones-parada")).toHaveCount(3);

  expect(await pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await contexto.close();
});

// cur-ac3 (cp-cur-03): cada curiosidad dice de dónde sale, enlaza a su frase y
// la inglesa se enseña tal cual, sin traducir.
async function sembrarCuriosidades(supabase: SupabaseClient, planId: string) {
  const { error: errorPlan } = await supabase.from("planes").insert({ id: planId, destino: "Londres" });
  if (errorPlan) throw new Error(`No se pudo sembrar el plan: ${errorPlan.message}`);
  const { data: version } = await supabase
    .from("plan_versiones")
    .insert({ plan_id: planId, version: 1, personas: 2, dias: [{ fecha: FECHA, franjas: franjasComoArray("Londres") }], avisos: [] })
    .select("id")
    .single();
  const { data: procedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
  if (!version || !procedencia) throw new Error("No se pudo sembrar la versión");
  const base = { plan_version_id: version.id, dia_index: 0, franja_id: "manana", descripcion: "Visita", duracion_min: 60, prioridad: 80, procedencia_id: procedencia.id };
  const es = "https://es.wikipedia.org/wiki/Museo_Brit%C3%A1nico";
  const items = [
    { texto: "Su colección reúne unos ocho millones de objetos.", idioma: "es", fuente: "wikipedia", url: `${es}#:~:text=Su%20colecci%C3%B3n%20re%C3%BAne%20unos%20ocho%20millones%20de%20objetos.`, seleccion: "modelo" },
    { texto: "Fue el primer museo nacional público del mundo.", idioma: "es", fuente: "wikipedia", url: `${es}#:~:text=Fue%20el%20primer%20museo%20nacional%20p%C3%BAblico%20del%20mundo.`, seleccion: "modelo" },
    { texto: "The museum was established in 1753.", idioma: "en", fuente: "wikipedia", url: "https://en.wikipedia.org/wiki/British_Museum#:~:text=The%20museum%20was%20established%20in%201753.", seleccion: "modelo" },
    { texto: "Recibe unos 5.820.000 visitantes al año (2019).", idioma: "es", fuente: "wikidata", url: "https://www.wikidata.org/wiki/Q6373", seleccion: "modelo" },
  ];
  const curiosidades = { frases: items.filter((i) => i.idioma === "es" && i.fuente === "wikipedia").map((i) => i.texto), url: es, items, seleccion: "modelo", mejora_intentada: true };
  const { error } = await supabase
    .from("paradas")
    .insert({ ...base, id_externo: "cur-1", nombre: "Parada con curiosidades", curiosidades, guia_intentada_en: "2026-10-05T10:00:00Z", guia_formato: 3 });
  if (error) throw new Error(`No se pudo sembrar la parada: ${error.message}`);
}

test("cp-cur-03: cada curiosidad lleva su rótulo y enlace; la inglesa va sin traducir (cur-ac3)", async ({ browser }) => {
  const supabase = clienteDePrueba("servicio");
  const email = "ci-test-guia-curiosidades@example.com";
  const { data: usuario, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !usuario.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  const planId = `plan-guia-curiosidades-${Date.now()}`;
  await sembrarCuriosidades(supabase, planId);
  const { error: errorTrabajo } = await supabase
    .from("trabajos")
    .insert({ usuario_id: usuario.user.id, tipo: "generacion", criterios: { perfil: "familiar", presupuesto_eur: 900 }, estado: "completado", plan_id: planId });
  if (errorTrabajo) throw new Error(`No se pudo sembrar el trabajo: ${errorTrabajo.message}`);

  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pagina = await contexto.newPage();
  expect((await contexto.request.post("/api/acceso/solicitar-codigo", { data: { email } })).ok()).toBe(true);
  const codigo = await leerCodigo(email);
  expect((await contexto.request.post("/api/acceso/verificar-codigo", { data: { email, codigo } })).ok()).toBe(true);

  await pagina.goto(`/plan/${planId}?dia=1`);
  const tarjeta = pagina.locator("li.tarjeta-parada", { hasText: "Parada con curiosidades" });
  // Los roles de un panel cerrado no están en el árbol de accesibilidad: hay que abrirlo antes.
  await tarjeta.locator("summary", { hasText: /^Consejos y curiosidades/ }).click();
  const bloque = tarjeta.getByTestId("curiosidades-parada");
  await expect(bloque).toBeVisible();
  const elementos = bloque.locator("li");
  await expect(elementos).toHaveCount(4);
  await expect(elementos.nth(0)).toContainText("Wikipedia");
  await expect(elementos.nth(0)).not.toContainText("en inglés");
  await expect(elementos.nth(0).getByRole("link")).toHaveAttribute("href", /^https:\/\/es\.wikipedia\.org\/.*#:~:text=/);
  await expect(elementos.nth(1).getByRole("link")).toHaveAttribute("href", /^https:\/\/es\.wikipedia\.org\/.*#:~:text=/);
  await expect(elementos.nth(2)).toContainText("The museum was established in 1753.");
  await expect(elementos.nth(2)).toContainText("Wikipedia · en inglés");
  await expect(elementos.nth(2).locator('[lang="en"]')).toHaveText("The museum was established in 1753.");
  await expect(elementos.nth(2).getByRole("link")).toHaveAttribute("href", /^https:\/\/en\.wikipedia\.org\/.*#:~:text=The%20museum/);
  await expect(elementos.nth(3)).toContainText("Wikidata");
  await expect(elementos.nth(3).getByRole("link")).toHaveAttribute("href", /^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/);
  await expect(bloque).toContainText("CC BY-SA");
  await expect(bloque).not.toContainText("traducido");
  await expect(bloque.getByRole("button", { name: /Ver original/ })).toHaveCount(0);
  expect(await pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await contexto.close();
});
