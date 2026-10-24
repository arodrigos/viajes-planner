// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reserva } from "@/lib/reservas/tipos";
import { SeccionReservas } from "../SeccionReservas";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FECHAS = ["2027-03-05", "2027-03-06", "2027-03-07"];
const json = (status: number, cuerpo: unknown) => new Response(status === 204 ? null : JSON.stringify(cuerpo), { status });

function api(inicial: Reserva[] = [], rechazo?: { estado: number; cuerpo: unknown }) {
  const lista = [...inicial];
  const llamadas: { url: string; metodo: string; cuerpo?: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? "GET";
      llamadas.push({ url, metodo, cuerpo: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (metodo === "GET") return json(200, lista);
      if (metodo === "POST") {
        if (rechazo) return json(rechazo.estado, rechazo.cuerpo);
        const nueva = { id: "r1", ...JSON.parse(String(init!.body)) } as Reserva;
        lista.push(nueva);
        return json(201, nueva);
      }
      lista.splice(0, lista.length);
      return json(204, null);
    }),
  );
  return { llamadas };
}

async function abrir() {
  const usuario = userEvent.setup();
  render(<SeccionReservas planId="plan-1" fechas={FECHAS} />);
  await usuario.click(screen.getByText("Reservas"));
  return usuario;
}

describe("SeccionReservas (reservas-datos)", () => {
  it("res-ac1 / uat-07: sin reservas enseña el estado vacío y el botón «Apuntar reserva»", async () => {
    api();
    await abrir();
    expect(await screen.findByText(/Apunta tus vuelos, trenes, hotel y entradas con hora/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apuntar reserva" })).toBeTruthy();
  });

  it("res-ac2 / uat-08: falta la hora de llegada → error en su campo y lo escrito no se pierde", async () => {
    const { llamadas } = api();
    const u = await abrir();
    await u.click(await screen.findByRole("button", { name: "Apuntar reserva" }));
    await u.type(screen.getByLabelText("Origen"), "MAD");
    await u.type(screen.getByLabelText("Destino"), "FCO");
    await u.type(screen.getByLabelText("Día de salida"), "2027-03-05");
    await u.type(screen.getByLabelText("Hora de salida"), "08:00");
    await u.type(screen.getByLabelText("Día de llegada"), "2027-03-05");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    const alerta = await screen.findByText(/Falta la hora de llegada: está en tu tarjeta de embarque/);
    expect(alerta.closest("div")?.querySelector("#reserva-hora_fin")).not.toBeNull();
    expect((screen.getByLabelText("Origen") as HTMLInputElement).value).toBe("MAD");
    expect(llamadas.filter((l) => l.metodo === "POST")).toHaveLength(0);
  });

  it("res-ac1 / uat-09: al completar y guardar sale en la lista «Vuelo de ida · MAD → FCO · llega 13:00 · ABC123»", async () => {
    const { llamadas } = api();
    const u = await abrir();
    await u.click(await screen.findByRole("button", { name: "Apuntar reserva" }));
    await u.type(screen.getByLabelText("Origen"), "MAD");
    await u.type(screen.getByLabelText("Destino"), "FCO");
    await u.type(screen.getByLabelText("Día de salida"), "2027-03-05");
    await u.type(screen.getByLabelText("Hora de salida"), "08:00");
    await u.type(screen.getByLabelText("Día de llegada"), "2027-03-05");
    await u.type(screen.getByLabelText("Hora de llegada"), "13:00");
    await u.type(screen.getByLabelText("Localizador (opcional)"), "ABC123");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Vuelo de ida · MAD → FCO · llega 13:00 · ABC123")).toBeTruthy();
    expect(screen.queryByTestId("reservas-vacio")).toBeNull();
    expect(llamadas.find((l) => l.metodo === "POST")?.url).toBe("/api/plan/plan-1/reservas");
    // Nada de /api/plan/<id>/orden ni de versión: guardar una reserva no toca el plan.
    expect(llamadas.every((l) => l.url.startsWith("/api/plan/plan-1/reservas"))).toBe(true);
  });

  it("«Entrada con hora» enseña solo nombre, día, hora y notas, sin origen ni sentido", async () => {
    api();
    const u = await abrir();
    await u.click(await screen.findByRole("button", { name: "Apuntar reserva" }));
    await u.selectOptions(screen.getByLabelText("Tipo de reserva"), "entrada");
    expect(screen.getByLabelText("Nombre de la entrada o visita")).toBeTruthy();
    expect(screen.queryByLabelText("Origen")).toBeNull();
    expect(screen.queryByLabelText("Trayecto")).toBeNull();
  });

  it("si el servidor rechaza, el mensaje sale y el formulario conserva lo escrito", async () => {
    api([], { estado: 409, cuerpo: { error: "Has llegado al máximo de 30 reservas en este viaje" } });
    const u = await abrir();
    await u.click(await screen.findByRole("button", { name: "Apuntar reserva" }));
    await u.selectOptions(screen.getByLabelText("Tipo de reserva"), "entrada");
    await u.type(screen.getByLabelText("Nombre de la entrada o visita"), "Borghese");
    await u.type(screen.getByLabelText("Día"), "2027-03-06");
    await u.type(screen.getByLabelText("Hora"), "10:30");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Has llegado al máximo de 30 reservas en este viaje")).toBeTruthy();
    expect((screen.getByLabelText("Nombre de la entrada o visita") as HTMLInputElement).value).toBe("Borghese");
  });

  it("res-ac7: unas notas con HTML se pintan como texto, sin ningún <img>", async () => {
    api([{ id: "r1", tipo: "entrada", nombre: "<img src=x onerror=alert(1)>", fecha_inicio: "2027-03-06", hora_inicio: "10:30" }]);
    await abrir();
    expect(await screen.findByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("borrar pide confirmación y quita la reserva de la lista", async () => {
    const { llamadas } = api([{ id: "r1", tipo: "hotel", nombre: "Hotel Sole", fecha_inicio: "2027-03-05", fecha_fin: "2027-03-07" }]);
    const u = await abrir();
    await u.click(await screen.findByRole("button", { name: "Borrar" }));
    expect(llamadas.filter((l) => l.metodo === "DELETE")).toHaveLength(0);
    await u.click(screen.getByRole("button", { name: "Sí, borrar" }));
    await waitFor(() => expect(screen.queryByTestId("reserva")).toBeNull());
    expect(llamadas.find((l) => l.metodo === "DELETE")?.url).toBe("/api/plan/plan-1/reservas/r1");
  });
});
