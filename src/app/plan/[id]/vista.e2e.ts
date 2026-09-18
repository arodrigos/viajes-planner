import { expect, test } from "@playwright/test";
import { franjasParaDestino } from "@/lib/plan/config-franjas";

// vista-ac2: a 360px, con los días y franjas por su etiqueta visible, sin
// ningún valor horario interno ni duración en minutos/horas en el HTML
// renderizado, y con el aviso fijo -sin control de cierre- siempre visible.
test.use({ viewport: { width: 360, height: 740 } });

const DESTINO = "Sevilla";

function diaFixture(fecha: string, indice: number) {
  const franjasConfig = franjasParaDestino(DESTINO);
  const franjas = Object.entries(franjasConfig).map(([id, def]) => ({ id, etiqueta: def.etiqueta }));
  return {
    fecha,
    franjas,
    paradas: [
      {
        id: `parada-${indice}`,
        franja_id: "manana",
        nombre: `Sitio del día ${indice + 1}`,
        descripcion: "Una visita tranquila, sin verificar contra ninguna ficha todavía.",
      },
    ],
  };
}

const PLAN_FIXTURE = {
  id: "plan-e2e",
  version: 1,
  destino: DESTINO,
  personas: 2,
  dias: [0, 1, 2, 3, 4].map((indice) => diaFixture(`2026-10-0${indice + 5}`, indice)),
  avisos: [],
};

test("el plan se lee a 360px con días y franjas por etiqueta, sin horarios ni duraciones, y con el aviso fijo", async ({
  page,
}) => {
  await page.route("**/api/plan/*", (route) => route.fulfill({ json: PLAN_FIXTURE }));

  await page.goto("/plan/plan-e2e");

  // (a) cinco secciones de día, franjas por etiqueta, sin desbordamiento.
  for (const dia of PLAN_FIXTURE.dias) {
    await expect(page.getByRole("heading", { name: dia.fecha })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Mañana", exact: true }).first()).toBeVisible();
  const anchoDocumento = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(anchoDocumento).toBeLessThanOrEqual(360);

  // (b) ningún horario interno ni duración en minutos/horas.
  const html = await page.content();
  const horasConfiguradas = Object.values(franjasParaDestino(DESTINO)).flatMap((f) => [f.hora_inicio, f.hora_fin]);
  for (const hora of horasConfiguradas) {
    expect(html).not.toContain(hora);
  }
  const textoVisible = await page.locator("body").innerText();
  expect(textoVisible).not.toMatch(/\d{1,2}[:h]\d{2}|\b\d+\s*(min|minutos|horas?)\b/);

  // (c) el aviso es visible al abrir, sigue visible tras recargar y no
  // tiene ningún control de cierre en el DOM.
  const aviso = page.getByText(/Ninguna parada está comprobada/);
  await expect(aviso).toBeVisible();
  await page.reload();
  await expect(aviso).toBeVisible();
  await expect(page.locator("button")).toHaveCount(0);
});
