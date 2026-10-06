import { expect, test } from "@playwright/test";
import { franjasParaDestino } from "@/lib/plan/config-franjas";
import { auditarHtml } from "@/lib/sin-afiliacion";

// vista-ac2: a 360px, con los días y franjas por su etiqueta visible, sin
// ningún valor horario interno ni duración en minutos/horas en el HTML
// renderizado, y con el aviso fijo -sin control de cierre- siempre visible.
test.use({ viewport: { width: 360, height: 740 } });

const DESTINO = "Sevilla";

// esqueleto-ac3: nombre y descripcion son los dos únicos campos que el
// modelo redacta libremente (generacion-ac1/ac2 solo acota tope y
// categorías, no el texto). Aquí simulan, a propósito, el peor caso -una
// respuesta con pinta de enlace de afiliación y de dominio publicitario-
// para comprobar que la vista los deja como texto inerte, no como href/src
// reales: es la única ruta donde el HTML auditado por
// verificar-esqueleto.sh (solo "/" ) no llega.
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
        descripcion:
          indice === 0
            ? "Reserva en https://booking.com/hotel?aid=999, patrocinado por doubleclick.net"
            : "Una visita tranquila, sin verificar contra ninguna ficha todavía.",
        procedencia: { fuente: "propuesto-sin-verificar" },
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
  // reco-ac5: nombre y motivo son texto libre igual que nombre/descripcion
  // de una parada -mismo peor caso a propósito, ahora en la sección de
  // recomendaciones. El dominio publicitario va en "motivo" (texto plano,
  // nunca dentro de un href) y no en "nombre": "nombre" SÍ acaba dentro del
  // href de la búsqueda (codificado por urlBusquedaSitio), y un dominio de
  // verdad ahí dispararía un falso positivo de contieneScriptPublicitario
  // -mismo motivo ya documentado en sin-afiliacion.ts para descripcion.
  recomendaciones: [
    {
      tipo: "comida",
      nombre: "Reserva en https://booking.com/mesa?aid=888",
      motivo: "Un sitio tranquilo, patrocinado por doubleclick.net, sin verificar contra ninguna ficha todavía.",
    },
  ],
};

test("el plan se lee a 360px con días y franjas por etiqueta, sin horarios ni duraciones, y con el aviso fijo", async ({
  page,
}) => {
  await page.route("**/api/plan/*", (route) => route.fulfill({ json: PLAN_FIXTURE }));

  await page.goto("/plan/plan-e2e?dia=1");

  // (a) cinco secciones de día, franjas por etiqueta, sin desbordamiento.
  await expect(page.getByRole("navigation", { name: "Días del viaje" }).getByRole("link")).toHaveCount(PLAN_FIXTURE.dias.length + 1);
  await expect(page.getByRole("heading", { level: 2, name: /^Día 1 · / })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mañana", exact: true }).first()).toBeVisible();
  const anchoDocumento = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(anchoDocumento).toBeLessThanOrEqual(360);

  // (b) ningún horario interno ni duración en minutos/horas, y el texto
  // libre del modelo (nombre/descripcion, con pinta de afiliación y de
  // dominio publicitario a propósito) llega como texto inerte, nunca como
  // un href/src real.
  const html = await page.content();
  const auditoria = auditarHtml(html);
  expect(auditoria.ok, auditoria.motivos.join("; ")).toBe(true);
  const horasConfiguradas = Object.values(franjasParaDestino(DESTINO)).flatMap((f) => [f.hora_inicio, f.hora_fin]);
  for (const hora of horasConfiguradas) {
    expect(html).not.toContain(hora);
  }
  const textoVisible = await page.locator("body").innerText();
  expect(textoVisible).not.toMatch(/\d{1,2}[:h]\d{2}|\b\d+\s*(min|minutos|horas?)\b/);

  // reco-ac5: el enlace de la recomendación envenenada apunta a la
  // búsqueda determinista, nunca al booking.com falso del nombre.
  const enlaceRecomendacion = page.getByRole("link", { name: /Reserva en https:\/\/booking\.com/ });
  await expect(enlaceRecomendacion).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);

  // (c) el aviso es visible al abrir, sigue visible tras recargar y no
  // tiene ningún control de cierre en el DOM.
  const aviso = page.getByText(/Las paradas marcadas como comprobadas/);
  await expect(aviso).toBeVisible();
  await page.reload();
  await expect(aviso).toBeVisible();
  // El aviso en sí (role="note") no lleva ningún control de cierre -los
  // botones "Cambiar" de alternativas-equivalentes son de cada parada, no
  // del aviso, así que la aserción original de "cero botones en toda la
  // página" ya no aplica desde ese bloque.
  await expect(page.getByRole("note").locator("button")).toHaveCount(0);
});
