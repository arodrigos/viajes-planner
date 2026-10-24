// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Gasto } from "@/lib/gastos/tipos";
import type { PresupuestoPublico } from "@/lib/presupuesto/texto";
import { SeccionGastos } from "../SeccionGastos";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FECHAS = ["2027-03-05", "2027-03-06", "2027-03-07"];
const PRESUPUESTO: PresupuestoPublico = {
  total_eur: 1200, total_estimado_eur: 1200, total_de_fuente_eur: 0, alojamiento_eur: 600, traslados_eur: 0, actividades_eur: 600,
  por_dia: FECHAS.map((fecha) => ({ fecha, total_eur: 200 })),
};
const json = (status: number, cuerpo: unknown) => new Response(status === 204 ? null : JSON.stringify(cuerpo), { status });

function api(inicial: Gasto[] = []) {
  const lista = [...inicial];
  const llamadas: { url: string; metodo: string; cuerpo?: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? "GET";
      llamadas.push({ url, metodo, cuerpo: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (metodo === "GET") return json(200, lista);
      // Servidor mínimo con estado: la lista que devuelve el GET tras subir
      // refleja lo subido, como el de verdad.
      const id = String(url).split("/").pop()!;
      const i = lista.findIndex((g) => g.id === id);
      if (metodo === "PUT") {
        const gasto = { id, ...JSON.parse(String(init?.body)) } as Gasto;
        if (i >= 0) lista[i] = gasto;
        else lista.unshift(gasto);
        return json(200, { ok: true });
      }
      if (i >= 0) lista.splice(i, 1);
      return json(204, null);
    }),
  );
  return { llamadas };
}

async function abrir() {
  const usuario = userEvent.setup();
  render(<SeccionGastos planId="plan-1" fechas={FECHAS} hoy="2026-01-01" presupuesto={PRESUPUESTO} />);
  await usuario.click(screen.getByText("Gastos"));
  return usuario;
}

describe("SeccionGastos (gastos-datos-y-comparacion)", () => {
  it("uat-14: sin gastos enseña «Queda <total>», el estado vacío y el formulario", async () => {
    api();
    await abrir();
    expect((await screen.findByTestId("gastos-titular")).textContent).toContain("Queda 1.200,00");
    expect(screen.getByTestId("gastos-vacio").textContent).toContain("Aún no has apuntado gastos");
    expect(screen.getByLabelText("Importe (€)")).toBeTruthy();
    expect(screen.getAllByRole("button", { pressed: false }).length + screen.getAllByRole("button", { pressed: true }).length).toBeGreaterThanOrEqual(4);
  });

  it("gas-ac1 / uat-15: 25,50 € de comida el día 2 baja el «Queda» exacto, suma en la fila del día y manda un PUT con el id del cliente", async () => {
    const { llamadas } = api();
    const u = await abrir();
    await screen.findByTestId("gastos-titular");
    await u.type(screen.getByLabelText("Importe (€)"), "25,50");
    await u.selectOptions(screen.getByLabelText("Día"), "2027-03-06");
    await u.click(screen.getByRole("button", { name: "Apuntar" }));
    await waitFor(() => expect(screen.getByTestId("gastos-titular").textContent).toContain("Queda 1.174,50"));
    const put = llamadas.find((l) => l.metodo === "PUT")!;
    expect(put.url).toMatch(/\/gastos\/[0-9a-f-]{36}$/);
    expect(put.cuerpo).toMatchObject({ importe_centimos: 2550, categoria: "comida", fecha: "2027-03-06" });
    expect(screen.getAllByTestId("gastos-fila-dia")[1].textContent).toContain("25,50");
    expect(screen.getByTestId("gasto").textContent).toContain("Comida · 25,50");
  });

  it("gas-ac5 / uat-15b: «Alojamiento» fija «Todo el viaje» con su ayuda y no pone ningún día en rojo", async () => {
    api();
    const u = await abrir();
    await screen.findByTestId("gastos-titular");
    await u.type(screen.getByLabelText("Importe (€)"), "600");
    await u.click(screen.getByRole("button", { name: "Alojamiento" }));
    expect(screen.getByText("El alojamiento se compara con el alojamiento estimado de todo el viaje")).toBeTruthy();
    expect((screen.getByLabelText("Día") as HTMLSelectElement).disabled).toBe(true);
    await u.click(screen.getByRole("button", { name: "Apuntar" }));
    await waitFor(() => expect(within(screen.getByTestId("gastos-fila-alojamiento")).getByText(/600,00/)).toBeTruthy());
    expect(document.querySelectorAll(".gasto-pasado")).toHaveLength(0);
  });

  it("gas-ac5 / uat-16: importe vacío o 0 muestra el error y no manda nada", async () => {
    const { llamadas } = api();
    const u = await abrir();
    await screen.findByTestId("gastos-titular");
    await u.click(screen.getByRole("button", { name: "Apuntar" }));
    expect(await screen.findByText("Escribe un importe entre 0,01 € y 100.000 €")).toBeTruthy();
    await u.type(screen.getByLabelText("Importe (€)"), "0");
    await u.click(screen.getByRole("button", { name: "Apuntar" }));
    expect(screen.getByText("Escribe un importe entre 0,01 € y 100.000 €")).toBeTruthy();
    expect(llamadas.filter((l) => l.metodo === "PUT")).toHaveLength(0);
  });

  it("gas-ac5: un día que se pasa sale en rojo con «+X €» y el titular dice «Te has pasado»", async () => {
    api([{ id: "11111111-1111-4111-8111-111111111111", importe_centimos: 25000, categoria: "transporte", fecha: "2027-03-05", actualizado_cliente: "2027-01-01T00:00:00.000Z" }]);
    await abrir();
    const filas = await screen.findAllByTestId("gastos-fila-dia");
    expect(filas[0].className).toContain("gasto-pasado");
    expect(filas[0].textContent).toContain("+50,00");
    expect(filas[1].className).not.toContain("gasto-pasado");
  });

  it("gas-ac5: borrar pide confirmación y deja «Deshacer», que vuelve a subir el mismo id", async () => {
    const g: Gasto = { id: "22222222-2222-4222-8222-222222222222", importe_centimos: 1000, categoria: "comida", fecha: "2027-03-05", actualizado_cliente: "2027-01-01T00:00:00.000Z" };
    const { llamadas } = api([g]);
    const u = await abrir();
    await u.click(await screen.findByRole("button", { name: "Borrar" }));
    expect(screen.getByText("¿Borrar este gasto?")).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Sí, borrar" }));
    expect(await screen.findByTestId("gastos-deshacer")).toBeTruthy();
    expect(llamadas.some((l) => l.metodo === "DELETE" && l.url.endsWith(g.id))).toBe(true);
    await u.click(screen.getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(screen.getByTestId("gasto").textContent).toContain("10,00"));
    expect(llamadas.filter((l) => l.metodo === "PUT").map((l) => l.url)).toEqual([expect.stringContaining(g.id)]);
  });
});
