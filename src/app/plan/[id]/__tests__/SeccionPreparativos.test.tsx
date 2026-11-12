// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { colaPreparativos } from "@/lib/preparativos/cola";
import type { DatosPreparativos } from "@/lib/preparativos/tipos";
import { SeccionPreparativos } from "../SeccionPreparativos";

// Familia con un bebé de 1 año, en julio, con GEO en el hemisferio norte.
const DATOS: DatosPreparativos = { personas: [{ edad: 1 }, { edad: 6 }, { edad: 38 }, { edad: 40 }], perfil: "familiar", fechas: { modo: "fechas", inicio: "2027-07-03", fin: "2027-07-09" }, dias: 7, transporte: [] };
const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status });

interface Servidor { enLinea: boolean; put: number; get: number; marcas: unknown[]; puts: { url: string; cuerpo: { estado: string } }[] }
function servidor(): Servidor {
  const e: Servidor = { enLinea: true, put: 200, get: 200, marcas: [], puts: [] };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (!e.enLinea) throw new TypeError("Failed to fetch");
    if ((init?.method ?? "GET") === "GET") return e.get === 200 ? json(200, { marcas: e.marcas }) : json(e.get, { error: "x" });
    e.puts.push({ url, cuerpo: JSON.parse(String(init?.body)) });
    return e.put === 200 ? json(200, { ok: true }) : json(e.put, { error: "rechazada" });
  }));
  return e;
}
const montar = () => render(<SeccionPreparativos planId="p1" datos={DATOS} latitud={41.9} tiposReserva={[]} />);
const abrir = async () => {
  await userEvent.click(screen.getByText("Preparativos y equipaje"));
  // Con las marcas ya cargadas: antes, la carga en vuelo pisaría lo que el test marca.
  await screen.findByTestId("preparativos-progreso");
};

beforeEach(async () => {
  await colaPreparativos().vaciarTodo();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SeccionPreparativos", () => {
  it("lis-ac1: marcar pinta la casilla, sube la marca y suma al contador", async () => {
    const s = servidor();
    montar();
    await abrir();
    const antes = screen.getByTestId("preparativos-progreso").textContent!;
    expect(antes).toMatch(/^0 de \d+ listos$/);
    await userEvent.click(screen.getByRole("checkbox", { name: "Pañales" }));
    expect(screen.getByRole("checkbox", { name: "Pañales" })).toBeChecked();
    expect(screen.getByTestId("preparativos-progreso")).toHaveTextContent(/^1 de \d+ listos$/);
    await waitFor(() => expect(s.puts).toHaveLength(1));
    expect(s.puts[0].url).toBe("/api/plan/p1/preparativos/panales");
    expect(s.puts[0].cuerpo.estado).toBe("hecho");
  });

  it("lis-ac2: sin red queda pendiente y al volver se sube sola", async () => {
    const s = servidor();
    montar();
    await abrir();
    s.enLinea = false;
    await userEvent.click(screen.getByRole("checkbox", { name: "Protector solar" }));
    expect(screen.getByRole("checkbox", { name: "Protector solar" })).toBeChecked();
    await waitFor(() => expect(screen.getByTestId("preparativos-sin-subir")).toHaveTextContent("1 cambio pendiente de subir"));
    expect(screen.getAllByTestId("preparativo-pendiente")).toHaveLength(1);
    s.enLinea = true;
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(screen.queryByTestId("preparativos-sin-subir")).toBeNull());
    expect(s.puts.at(-1)?.url).toBe("/api/plan/p1/preparativos/protector-solar");
  });

  it("lis-ac3: «No me hace falta» saca el elemento, baja el total y se puede deshacer y recuperar", async () => {
    const s = servidor();
    montar();
    await abrir();
    const total0 = Number(screen.getByTestId("preparativos-progreso").textContent!.match(/de (\d+)/)![1]);
    const fila = () => screen.getAllByTestId("preparativo").find((f) => within(f).queryByText("Carrito o mochila portabebés"))!;
    await userEvent.click(within(fila()).getByRole("button", { name: "No me hace falta" }));
    expect(screen.queryAllByTestId("preparativo").some((f) => f.textContent!.includes("Carrito"))).toBe(false);
    expect(screen.getByText("No me hacen falta (1)")).toBeInTheDocument();
    expect(screen.getByTestId("preparativos-progreso")).toHaveTextContent(`de ${total0 - 1} listos`);
    await userEvent.click(within(screen.getByTestId("preparativos-deshacer")).getByRole("button", { name: "Deshacer" }));
    expect(fila()).toBeDefined();
    await userEvent.click(within(fila()).getByRole("button", { name: "No me hace falta" }));
    await userEvent.click(screen.getByText("No me hacen falta (1)"));
    await userEvent.click(within(screen.getByTestId("preparativo-descartado")).getByRole("button", { name: "Recuperar" }));
    expect(fila()).toBeDefined();
    await waitFor(() => expect(s.puts.at(-1)?.cuerpo.estado).toBe("pendiente"));
  });

  it("lis-ac7: un 400 deja la marca visible como no guardada", async () => {
    const s = servidor();
    s.put = 400;
    montar();
    await abrir();
    await userEvent.click(screen.getByRole("checkbox", { name: "Pañales" }));
    expect(await screen.findByTestId("preparativo-rechazado")).toHaveTextContent("No se ha podido guardar: vuelve a marcarlo");
  });

  it("lis-ac7: un 401 deja todo pendiente con «Entra de nuevo»", async () => {
    const s = servidor();
    s.put = 401;
    montar();
    await abrir();
    await userEvent.click(screen.getByRole("checkbox", { name: "Pañales" }));
    expect(await screen.findByTestId("preparativos-sin-sesion")).toHaveTextContent("Entra de nuevo para subir tus marcas");
    expect(screen.getByTestId("preparativo-pendiente")).toBeInTheDocument();
  });

  it("lis-ac10: si falla la carga de marcas se ve la lista con aviso y «Reintentar»", async () => {
    const s = servidor();
    s.get = 500;
    montar();
    await abrir();
    expect(await screen.findByTestId("preparativos-error-marcas")).toHaveTextContent("No se han podido cargar tus marcas");
    s.get = 200;
    s.marcas = [{ elemento: "panales", estado: "hecho", actualizado_cliente: "2027-01-01T00:00:00.000Z" }];
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Pañales" })).toBeChecked());
    expect(screen.queryByTestId("preparativos-error-marcas")).toBeNull();
  });

  it("lis-ac4: sin red se ve la lista con las marcas del espejo y el aviso de copia", async () => {
    const s = servidor();
    s.marcas = [{ elemento: "panales", estado: "hecho", actualizado_cliente: "2027-01-01T00:00:00.000Z" }];
    const primera = montar();
    await abrir();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Pañales" })).toBeChecked());
    primera.unmount();
    s.enLinea = false;
    montar();
    await abrir();
    await waitFor(() => expect(screen.getByTestId("preparativos-copia")).toHaveTextContent(/^Sin conexión: tus marcas de /));
    expect(screen.getByRole("checkbox", { name: "Pañales" })).toBeChecked();
  });

  it("lis-ac10: con el plan aún generándose se ve el mensaje y no hay lista", async () => {
    servidor();
    render(<SeccionPreparativos planId="p1" datos={undefined} latitud={null} tiposReserva={[]} />);
    await userEvent.click(screen.getByText("Preparativos y equipaje"));
    expect(screen.getByTestId("preparativos-generando")).toHaveTextContent("La lista aparece cuando el viaje esté listo");
    expect(screen.queryAllByTestId("preparativo")).toHaveLength(0);
  });

  it("lis-ac9: las casillas se nombran con el texto del elemento y el cambio se anuncia en un status", async () => {
    servidor();
    montar();
    await abrir();
    await userEvent.click(screen.getByRole("checkbox", { name: "Pañales" }));
    expect(screen.getAllByRole("status").some((n) => n.textContent === "Pañales: marcado")).toBe(true);
  });
});
