import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import { readFileSync } from "node:fs";
import { capturar } from "./capturas";

// cap-ac2: página de control con un correo visible, sin tocar la app ni la
// base de datos. La captura es además la que declara capturas-esperadas.ts.
const CORREO = "persona@example.com";

function pixel(ruta: string, x: number, y: number): [number, number, number] {
  const png = PNG.sync.read(readFileSync(ruta));
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

test("el helper tapa los correos y los nodos data-sensible; sin él se ven", async ({ page }, testInfo) => {
  await page.setContent(`
    <body style="margin:0;background:#fff;color:#000;font:20px sans-serif">
      <p id="correo" style="margin:20px">${CORREO}</p>
      <p id="sensible" data-sensible style="margin:20px">Dato sensible sin arroba</p>
      <p id="publico" style="margin:20px">Texto público</p>
      <input id="campo" value="otra@example.org" style="margin:20px;width:260px;font:20px sans-serif" />
    </body>`);
  const escala = await page.evaluate(() => window.devicePixelRatio);
  const centro = async (id: string) => {
    const caja = await page.locator(id).boundingBox();
    if (!caja) throw new Error(`Sin caja para ${id}`);
    return { x: (caja.x + caja.width / 2) * escala, y: (caja.y + caja.height / 2) * escala };
  };

  const sinHelper = testInfo.outputPath("sin-helper.png");
  await page.screenshot({ path: sinHelper });
  const conHelper = await capturar(page, "capturas-ui", "correo-enmascarado");

  for (const id of ["#correo", "#sensible", "#campo"]) {
    const { x, y } = await centro(id);
    expect(pixel(conHelper, x, y), `${id} con helper`).toEqual([255, 0, 255]);
  }
  // El texto público no se tapa.
  const publico = await centro("#publico");
  expect(pixel(conHelper, publico.x, publico.y)).not.toEqual([255, 0, 255]);

  // Control negativo: la misma página sin helper no tiene un solo píxel magenta
  // en la caja del correo, o sea que el texto sí estaba a la vista.
  const caja = await page.locator("#correo").boundingBox();
  if (!caja) throw new Error("Sin caja para #correo");
  const png = PNG.sync.read(readFileSync(sinHelper));
  let magentas = 0;
  let oscuros = 0;
  for (let py = Math.floor(caja.y * escala); py < (caja.y + caja.height) * escala; py++) {
    for (let px = Math.floor(caja.x * escala); px < (caja.x + caja.width) * escala; px++) {
      const i = (py * png.width + px) * 4;
      if (png.data[i] === 255 && png.data[i + 1] === 0 && png.data[i + 2] === 255) magentas++;
      if (png.data[i] < 80 && png.data[i + 1] < 80) oscuros++;
    }
  }
  expect(magentas).toBe(0);
  expect(oscuros).toBeGreaterThan(50);

  // El marcador temporal no deja rastro en el DOM.
  await expect(page.locator("[data-capturas-mascara]")).toHaveCount(0);
});
