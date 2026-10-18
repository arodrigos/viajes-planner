// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelViajes } from "@/app/viajes/PanelViajes";

const borrarCopias = vi.fn(async () => {});
const borrarCopiaPlan = vi.fn(async (id: string) => void id);
vi.mock("@/lib/sinConexion/borrar", () => ({
  borrarCopias: () => borrarCopias(),
  borrarCopiaPlan: (id: string) => borrarCopiaPlan(id),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const DATOS = {
  correo: "familia@ej.com",
  viajes: [{ id: "t1", destino: "Lisboa", fecha: "2026-11-10 – 2026-11-14", estado: "completado", plan_id: "plan-1" }],
};

describe("PanelViajes -- copia del plan y sesión (ses-ac1, ses-ac3)", () => {
  it("cerrar sesión borra las copias aunque el POST falle", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new TypeError("sin red");
      return new Response(JSON.stringify(DATOS), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const usuario = userEvent.setup();
    render(<PanelViajes />);
    await waitFor(() => expect(screen.getByText("Lisboa")).toBeInTheDocument());
    await usuario.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(borrarCopias).toHaveBeenCalledTimes(1));
  });

  it("eliminar de verdad borra la copia de su plan; cancelar no", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? new Response("{}", { status: 200 }) : new Response(JSON.stringify(DATOS), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const usuario = userEvent.setup();
    render(<PanelViajes />);
    await waitFor(() => expect(screen.getByText("Lisboa")).toBeInTheDocument());
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(borrarCopiaPlan).not.toHaveBeenCalled();
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    await usuario.click(screen.getByRole("button", { name: /Eliminar de verdad/ }));
    await waitFor(() => expect(borrarCopiaPlan).toHaveBeenCalledWith("plan-1"));
  });

  it("si el DELETE falla no se borra la copia", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? new Response("{}", { status: 500 }) : new Response(JSON.stringify(DATOS), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const usuario = userEvent.setup();
    render(<PanelViajes />);
    await waitFor(() => expect(screen.getByText("Lisboa")).toBeInTheDocument());
    await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
    await usuario.click(screen.getByRole("button", { name: /Eliminar de verdad/ }));
    await screen.findByRole("alert");
    expect(borrarCopiaPlan).not.toHaveBeenCalled();
  });
});
