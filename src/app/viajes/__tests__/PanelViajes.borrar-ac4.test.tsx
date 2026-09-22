// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelViajes } from "@/app/viajes/PanelViajes";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DATOS = {
  correo: "familia@ej.com",
  viajes: [{ id: "t1", destino: "Lisboa", fecha: "2026-11-10 – 2026-11-14", estado: "completado", plan_id: "plan-1" }],
};

async function irAlSegundoPaso(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const usuario = userEvent.setup();
  render(<PanelViajes />);
  await waitFor(() => expect(screen.getByText("Lisboa")).toBeInTheDocument());
  await usuario.click(screen.getByRole("button", { name: "Eliminar" }));
  return usuario;
}

// borrar-ac4: la confirmación dice la verdad y solo la verdad, nombra el
// viaje, y cancelar es la salida por defecto.
describe("PanelViajes -- confirmación de borrado (borrar-ac4)", () => {
  it("nombra el viaje, explica el efecto sin prometer papelera, y el foco inicial está en Cancelar", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(DATOS), { status: 200 }));
    await irAlSegundoPaso(fetchMock);

    const dialogo = screen.getByRole("alertdialog", { name: /Lisboa/ });
    expect(dialogo.textContent).toMatch(/no se puede deshacer desde la aplicación/i);
    expect(dialogo.textContent).not.toMatch(/papelera|recuperar/i);

    const cancelar = screen.getByRole("button", { name: "Cancelar" });
    expect(cancelar).toHaveFocus();
  });

  it("cancelar no elimina nada: el viaje sigue en la lista y no se llama a DELETE", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(DATOS), { status: 200 }));
    const usuario = await irAlSegundoPaso(fetchMock);

    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.getByText("Lisboa")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1); // solo la carga inicial, ningún DELETE.
  });

  it("un DELETE que falla muestra un mensaje de error explicado y el viaje sigue en la lista", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(JSON.stringify({ error: "fallo" }), { status: 500 });
      return new Response(JSON.stringify(DATOS), { status: 200 });
    });
    const usuario = await irAlSegundoPaso(fetchMock);

    await usuario.click(screen.getByRole("button", { name: "Eliminar de verdad" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toMatch(/no se ha podido eliminar/i);
    expect(screen.getAllByText("Lisboa").length).toBeGreaterThan(0);
  });

  it("confirmar elimina de verdad: el viaje desaparece de la lista tras un DELETE exitoso", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify(DATOS), { status: 200 });
    });
    const usuario = await irAlSegundoPaso(fetchMock);

    await usuario.click(screen.getByRole("button", { name: "Eliminar de verdad" }));

    await waitFor(() => expect(screen.queryByText("Lisboa")).not.toBeInTheDocument());
  });
});
