// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { colaDeSalida } from "@/lib/gastos/cola";
import type { Gasto } from "@/lib/gastos/tipos";
import type { PresupuestoPublico } from "@/lib/presupuesto/texto";
import { SeccionGastos } from "../SeccionGastos";

const FECHAS = ["2027-03-05", "2027-03-06", "2027-03-07"];
const PRESUPUESTO: PresupuestoPublico = {
  total_eur: 1200, total_estimado_eur: 1200, total_de_fuente_eur: 0, alojamiento_eur: 600, traslados_eur: 0, actividades_eur: 600,
  por_dia: FECHAS.map((fecha) => ({ fecha, total_eur: 200 })),
};
const SUBIDO: Gasto = { id: "11111111-1111-4111-8111-111111111111", importe_centimos: 1000, categoria: "comida", fecha: "2027-03-05", actualizado_cliente: "2027-01-01T00:00:00.000Z" };
const json = (status: number, cuerpo: unknown) => new Response(status === 204 ? null : JSON.stringify(cuerpo), { status });

// Servidor con estado y con un interruptor de red: sin red, todo fetch lanza.
function servidor(inicial: Gasto[] = [SUBIDO]) {
  const lista = [...inicial];
  const estado = { enLinea: true, putEstado: 200 as number, putCuerpo: undefined as unknown, llamadas: [] as { metodo: string; url: string }[] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!estado.enLinea) throw new TypeError("Failed to fetch");
      const metodo = init?.method ?? "GET";
      estado.llamadas.push({ metodo, url });
      if (metodo === "GET") return json(200, lista);
      const id = String(url).split("/").pop()!;
      const i = lista.findIndex((g) => g.id === id);
      if (metodo === "PUT") {
        if (estado.putEstado !== 200) return json(estado.putEstado, estado.putCuerpo ?? {});
        const g = { id, ...JSON.parse(String(init?.body)) } as Gasto;
        if (i >= 0) lista[i] = g;
        else lista.unshift(g);
        return json(200, { ok: true });
      }
      if (i >= 0) lista.splice(i, 1);
      return json(204, null);
    }),
  );
  return { lista, estado };
}

beforeEach(async () => {
  await colaDeSalida().vaciarTodo();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function abrir() {
  const u = userEvent.setup();
  render(<SeccionGastos planId="plan-1" fechas={FECHAS} hoy="2026-01-01" presupuesto={PRESUPUESTO} />);
  await u.click(screen.getByText("Gastos"));
  await screen.findByTestId("gastos-titular");
  return u;
}
const volverLaRed = (s: ReturnType<typeof servidor>) => act(async () => {
  s.estado.enLinea = true;
  window.dispatchEvent(new Event("online"));
});

describe("SeccionGastos sin conexión (off-ac1..off-ac4, uat-17, uat-18)", () => {
  it("off-ac1 / uat-17: sin red el gasto sale al instante «Pendiente de subir», con contador y el «Queda» ya lo descuenta", async () => {
    const s = servidor();
    const u = await abrir();
    expect(screen.getByTestId("gastos-titular").textContent).toContain("Queda 1.190,00");
    s.estado.enLinea = false;
    await u.type(screen.getByLabelText("Importe (€)"), "12");
    await u.click(screen.getByRole("button", { name: "Entradas" }));
    await u.click(screen.getByRole("button", { name: "Apuntar" }));
    await waitFor(() => expect(screen.getAllByTestId("gasto")).toHaveLength(2));
    expect(screen.getByTestId("gasto-pendiente").textContent).toBe("Pendiente de subir");
    expect(screen.getByTestId("gastos-sin-subir").textContent).toBe("1 gasto sin subir");
    expect(screen.getByTestId("gastos-titular").textContent).toContain("Queda 1.178,00");
  });

  it("off-ac2 / uat-18: al volver la red se sube solo, una sola vez, y desaparecen la marca y el contador", async () => {
    const s = servidor();
    const u = await abrir();
    s.estado.enLinea = false;
    await u.type(screen.getByLabelText("Importe (€)"), "12");
    await u.click(screen.getByRole("button", { name: "Entradas" }));
    await u.click(screen.getByRole("button", { name: "Apuntar" }));
    await screen.findByTestId("gasto-pendiente");
    await volverLaRed(s);
    await waitFor(() => expect(screen.queryByTestId("gasto-pendiente")).toBeNull());
    expect(screen.queryByTestId("gastos-sin-subir")).toBeNull();
    expect(s.lista).toHaveLength(2);
    expect(s.estado.llamadas.filter((l) => l.metodo === "PUT")).toHaveLength(1);
    expect(screen.getAllByTestId("gasto")).toHaveLength(2);
  });

  it("sin red y con copia previa, la lista se ve al reabrir y lo pendiente sigue ahí", async () => {
    const s = servidor();
    await abrir();
    cleanup();
    s.estado.enLinea = false;
    await colaDeSalida().encolar({ clave: "gasto:22222222-2222-4222-8222-222222222222", ambito: "plan-1", tipo: "guardar", url: "/api/plan/plan-1/gastos/22222222-2222-4222-8222-222222222222", cuerpo: { importe_centimos: 500, categoria: "transporte", fecha: null, actualizado_cliente: "2027-02-01T00:00:00.000Z" } });
    await abrir();
    expect(screen.getAllByTestId("gasto")).toHaveLength(2);
    expect(screen.getByTestId("gasto-pendiente")).toBeTruthy();
    expect(screen.queryByText(/No se han podido cargar los gastos/)).toBeNull();
  });

  it("sin red y sin copia no inventa una lista vacía: avisa", async () => {
    const s = servidor();
    s.estado.enLinea = false;
    render(<SeccionGastos planId="plan-1" fechas={FECHAS} hoy="2026-01-01" presupuesto={PRESUPUESTO} />);
    await userEvent.setup().click(screen.getByText("Gastos"));
    expect(await screen.findByText(/No se han podido cargar los gastos/)).toBeTruthy();
    expect(screen.queryByTestId("gastos-titular")).toBeNull();
  });

  it("off-ac3: con la sesión caducada (401) el gasto no se pierde y avisa de iniciar sesión", async () => {
    const s = servidor();
    const u = await abrir();
    s.estado.putEstado = 401;
    await u.type(screen.getByLabelText("Importe (€)"), "12");
    await u.click(screen.getByRole("button", { name: "Entradas" }));
    await u.click(screen.getByRole("button", { name: "Apuntar" }));
    const aviso = await screen.findByTestId("gastos-sin-sesion");
    expect(aviso.textContent).toContain("Inicia sesión para subir 1 gasto");
    expect(within(aviso).getByRole("link").getAttribute("href")).toBe("/viajes");
    expect(screen.getAllByTestId("gasto")).toHaveLength(2);
    // Al volver la sesión se sube sin tocar nada.
    s.estado.putEstado = 200;
    await volverLaRed(s);
    await waitFor(() => expect(screen.queryByTestId("gastos-sin-sesion")).toBeNull());
    expect(s.lista).toHaveLength(2);
  });

  it("off-ac4: un rechazo (400) deja el gasto en rojo con su motivo, con Editar y Descartar, y no desaparece solo", async () => {
    const s = servidor();
    s.estado.putEstado = 400;
    s.estado.putCuerpo = { error: "Ese gasto no se puede guardar" };
    const u = await abrir();
    await u.type(screen.getByLabelText("Importe (€)"), "12");
    await u.click(screen.getByRole("button", { name: "Entradas" }));
    await u.click(screen.getByRole("button", { name: "Apuntar" }));
    const rechazado = await screen.findByTestId("gasto-rechazado");
    expect(rechazado.textContent).toBe("No se ha podido subir: Ese gasto no se puede guardar");
    const fila = rechazado.closest("li")!;
    expect(fila.className).toContain("gasto-rechazado");
    expect(within(fila).getByRole("button", { name: "Editar" })).toBeTruthy();
    // No cuenta en los totales ni en «sin subir».
    expect(screen.getByTestId("gastos-titular").textContent).toContain("Queda 1.190,00");
    expect(screen.queryByTestId("gastos-sin-subir")).toBeNull();
    await volverLaRed(s);
    expect(screen.getAllByTestId("gasto")).toHaveLength(2);
    await u.click(within(fila).getByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(screen.getAllByTestId("gasto")).toHaveLength(1));
  });

  it("off-ac4: editar un pendiente antes de subirlo sube solo la última versión", async () => {
    const s = servidor([]);
    const u = await abrir();
    s.estado.enLinea = false;
    await u.type(screen.getByLabelText("Importe (€)"), "12");
    await u.click(screen.getByRole("button", { name: "Entradas" }));
    await u.click(screen.getByRole("button", { name: "Apuntar" }));
    await u.click(await screen.findByRole("button", { name: "Editar" }));
    const campo = screen.getByLabelText("Importe (€)");
    await u.clear(campo);
    await u.type(campo, "20");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.getByTestId("gasto").textContent).toContain("20,00"));
    expect(screen.getAllByTestId("gasto")).toHaveLength(1);
    await volverLaRed(s);
    await waitFor(() => expect(screen.queryByTestId("gasto-pendiente")).toBeNull());
    expect(s.lista.map((g) => g.importe_centimos)).toEqual([2000]);
    expect(s.estado.llamadas.filter((l) => l.metodo === "PUT")).toHaveLength(1);
  });

  it("off-ac4: borrar un gasto subido sin red lo quita de la lista al momento y del servidor al volver", async () => {
    const s = servidor();
    const u = await abrir();
    s.estado.enLinea = false;
    await u.click(screen.getByRole("button", { name: "Borrar" }));
    await u.click(screen.getByRole("button", { name: "Sí, borrar" }));
    await waitFor(() => expect(screen.queryByTestId("gasto")).toBeNull());
    expect(s.lista).toHaveLength(1);
    await volverLaRed(s);
    await waitFor(() => expect(s.lista).toHaveLength(0));
    expect(screen.queryByTestId("gasto")).toBeNull();
  });
});
