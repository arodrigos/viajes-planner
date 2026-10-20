// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Compartir } from "../Compartir";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (status: number, cuerpo: unknown) => new Response(status === 204 ? null : JSON.stringify(cuerpo), { status });

// Simula la API de miembros con un estado propio: lo que se invita aparece en el GET siguiente.
function apiMiembros(inicial: { id: string; correo: string }[] = [], rechazo?: { estado: number; error: string }) {
  const lista = [...inicial];
  const llamadas: { url: string; metodo: string; cuerpo?: unknown }[] = [];
  const falso = vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    llamadas.push({ url, metodo, cuerpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (metodo === "GET") return json(200, { miembros: lista });
    if (metodo === "POST") {
      if (rechazo) return json(rechazo.estado, { error: rechazo.error });
      const nuevo = { id: `m${lista.length + 1}`, correo: JSON.parse(String(init!.body)).correo as string };
      lista.push(nuevo);
      return json(201, nuevo);
    }
    const id = url.split("/").pop()!;
    lista.splice(0, lista.length, ...lista.filter((m) => m.id !== id));
    return json(204, null);
  });
  vi.stubGlobal("fetch", falso);
  return { llamadas, lista };
}

async function abrir() {
  const usuario = userEvent.setup();
  render(<Compartir planId="plan-1" />);
  await usuario.click(screen.getByText("Compartir"));
  return usuario;
}

describe("Compartir (cmu-ac1, cmu-ac4, cmu-ac5, cmu-ac6)", () => {
  it("sin invitados enseña el estado vacío y la ayuda, y nada de lista", async () => {
    apiMiembros();
    await abrir();
    expect(await screen.findByText("Todavía no lo has compartido con nadie")).toBeInTheDocument();
    expect(screen.getByText(/Solo correos que ya pueden entrar en viajes\. Verán el plan y tus notas, pero no tu presupuesto ni el alojamiento, y no podrán cambiarlo\./)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Con acceso" })).toBeNull();
  });

  it("invitar pasa el botón a «Invitando…» al instante y deja el correo en «Con acceso» con «Quitar acceso»", async () => {
    let liberar: (r: Response) => void = () => undefined;
    const base = apiMiembros();
    const original = vi.mocked(fetch);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => (init?.method === "POST" ? new Promise<Response>((r) => (liberar = r)) : original(url, init))),
    );
    const usuario = await abrir();
    await screen.findByText("Todavía no lo has compartido con nadie");
    await usuario.type(screen.getByLabelText("Correo de la persona"), "ci-invitado@example.com");
    await usuario.click(screen.getByRole("button", { name: "Invitar" }));
    expect(screen.getByRole("button", { name: "Invitando…" })).toBeDisabled();
    liberar(json(201, { id: "m1", correo: "ci-invitado@example.com" }));
    const lista = await screen.findByRole("list", { name: "Con acceso" });
    expect(within(lista).getByText("ci-invitado@example.com")).toHaveAttribute("data-sensible");
    expect(within(lista).getByRole("button", { name: "Quitar acceso" })).toBeInTheDocument();
    expect(screen.getByLabelText("Correo de la persona")).toHaveValue("");
    expect(base.llamadas.some((l) => l.metodo === "GET")).toBe(true);
  });

  it.each([
    [400, "Escribe un correo válido."],
    [422, "Ese correo no puede entrar en viajes. Solo se puede compartir con correos que ya tienen acceso."],
    [422, "Ese es tu propio correo."],
    [422, "Este plan ya está compartido con 10 personas, que es el máximo."],
  ])("el error %i de la API se enseña junto al campo y la lista no cambia: %s", async (estado, error) => {
    apiMiembros([], { estado, error });
    const usuario = await abrir();
    await screen.findByText("Todavía no lo has compartido con nadie");
    await usuario.type(screen.getByLabelText("Correo de la persona"), "nadie@example.com");
    await usuario.click(screen.getByRole("button", { name: "Invitar" }));
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(error);
    expect(screen.getByLabelText("Correo de la persona")).toHaveAccessibleDescription(new RegExp(error.slice(0, 20)));
    expect(screen.getByText("Todavía no lo has compartido con nadie")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invitar" })).toBeEnabled();
  });

  it("«Quitar acceso» pide confirmación; cancelar no borra y confirmar vacía la lista", async () => {
    const api = apiMiembros([{ id: "m1", correo: "ci-invitado@example.com" }]);
    const usuario = await abrir();
    await usuario.click(await screen.findByRole("button", { name: "Quitar acceso" }));
    await usuario.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByText("ci-invitado@example.com")).toBeInTheDocument();
    expect(api.llamadas.some((l) => l.metodo === "DELETE")).toBe(false);

    await usuario.click(screen.getByRole("button", { name: "Quitar acceso" }));
    await usuario.click(screen.getByRole("button", { name: "Sí, quitar acceso" }));
    await waitFor(() => expect(screen.getByText("Todavía no lo has compartido con nadie")).toBeInTheDocument());
    expect(api.llamadas.find((l) => l.metodo === "DELETE")?.url).toBe("/api/plan/plan-1/miembros/m1");
  });

  it("si la lista no se puede leer lo dice, sin confundirlo con «nadie»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(500, { error: "x" })));
    await abrir();
    expect(await screen.findByRole("alert")).toHaveTextContent("No se ha podido cargar quién tiene acceso");
    expect(screen.queryByText("Todavía no lo has compartido con nadie")).toBeNull();
  });
});
