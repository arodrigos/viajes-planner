// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reserva } from "@/lib/reservas/tipos";
import { SeccionReservas } from "../SeccionReservas";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FECHAS = ["2027-07-03", "2027-07-04", "2027-07-05", "2027-07-06", "2027-07-07", "2027-07-08", "2027-07-09"];
const fixture = (n: string) => readFileSync(join(__dirname, "..", "..", "..", "..", "lib", "reservas", "importar", "__fixtures__", n), "utf8");
const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status });

function api(inicial: Reserva[] = []) {
  const lista = [...inicial];
  const posts: Record<string, unknown>[] = [];
  const otras: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? "GET";
      if (metodo === "GET") return json(200, lista);
      if (metodo === "POST") {
        const cuerpo = JSON.parse(String(init!.body));
        posts.push(cuerpo);
        const nueva = { id: `r${posts.length}`, ...cuerpo } as Reserva;
        lista.push(nueva);
        return json(201, nueva);
      }
      otras.push(`${metodo} ${url}`);
      return json(500, {});
    }),
  );
  return { posts, otras };
}

async function abrir() {
  const u = userEvent.setup();
  render(<SeccionReservas planId="plan-1" fechas={FECHAS} />);
  await u.click(screen.getByText("Reservas"));
  await screen.findByRole("button", { name: "Importar desde archivo" });
  return u;
}

// File.text() no existe en jsdom: se parchea en el objeto, que es lo único que lee el componente.
function fichero(contenido: string, nombre = "r.ics"): File {
  const f = new File([contenido], nombre, { type: "text/calendar" });
  Object.defineProperty(f, "text", { value: async () => contenido });
  return f;
}
const subir = (u: ReturnType<typeof userEvent.setup>, f: File) => u.upload(screen.getByTestId("importar-archivo"), f);

describe("importar una reserva desde .ics (imp-ac1..ac5, ac10)", () => {
  it("imp-ac1: un evento abre el formulario de hotel relleno y no guarda hasta pulsar Guardar", async () => {
    const { posts } = api();
    const u = await abrir();
    await subir(u, fichero(fixture("hotel-booking.ics")));
    expect(await screen.findByLabelText("Nombre del hotel")).toHaveProperty("value", "Hotel Arco Sereno");
    expect(screen.getByLabelText("Día de entrada")).toHaveProperty("value", "2027-07-03");
    expect(screen.getByLabelText("Día de salida")).toHaveProperty("value", "2027-07-09");
    expect(screen.getByText("Ubicación guardada")).toBeTruthy();
    expect(posts).toHaveLength(0);
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ tipo: "hotel", nombre: "Hotel Arco Sereno", fecha_inicio: "2027-07-03", fecha_fin: "2027-07-09", ubicacion: { lat: 41.9, lon: 12.49 } });
    expect(await screen.findByText("Reserva guardada")).toBeTruthy();
  });

  it("imp-ac2/ac3: varios eventos → lista, formulario con Falta/Sugerido y zonas, y «siguiente (2 de 2)»", async () => {
    const { posts } = api();
    const u = await abrir();
    await subir(u, fichero(fixture("vuelo-ida-vuelta.ics")));
    expect(await screen.findByText("Este archivo trae 2 reservas")).toBeTruthy();
    const tarjetas = screen.getAllByTestId("evento-ics");
    expect(tarjetas[0].textContent).toContain("07:35 · sáb 3 jul 2027 · hora de Madrid");
    expect(tarjetas[1].textContent).toContain("19:20 · vie 9 jul 2027 · hora de Roma");
    await u.click(within(tarjetas[0]).getByRole("button", { name: "Usar esta" }));

    expect(screen.getByLabelText("Tipo de reserva")).toHaveProperty("value", "vuelo");
    expect(screen.getByText("Zona de salida: Europe/Madrid", { exact: false })).toBeTruthy();
    expect(screen.getByText("Zona de llegada: Europe/Rome", { exact: false })).toBeTruthy();
    // Trayecto es un hueco; tipo, origen y destino son deducidos.
    expect(screen.getAllByText("Falta: complétalo").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Sugerido: revísalo").length).toBeGreaterThanOrEqual(3);
    expect(posts).toHaveLength(0);

    await u.selectOptions(screen.getByLabelText("Trayecto"), "ida");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ tipo: "vuelo", sentido: "ida", origen: "MAD", destino: "FCO", hora_inicio: "07:35", zona_inicio: "Europe/Madrid", zona_fin: "Europe/Rome" });

    await u.click(await screen.findByRole("button", { name: "Importar la siguiente del archivo (2 de 2)" }));
    expect(screen.getByLabelText("Hora de salida")).toHaveProperty("value", "19:20");
    expect(screen.getByText("Zona de salida: Europe/Rome", { exact: false })).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(posts).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Importar la siguiente/ })).toBeNull();
  });

  it("imp-ac4: un archivo que no es .ics da el mensaje y no abre ningún formulario", async () => {
    api();
    const u = await abrir();
    await subir(u, fichero("hola", "no.txt"));
    expect((await screen.findByTestId("importar-error")).textContent).toContain("Este archivo no es un calendario (.ics)");
    expect(screen.queryByLabelText("Tipo de reserva")).toBeNull();
  });

  it("imp-ac4: un archivo mayor de 256 KB se rechaza sin leerlo", async () => {
    api();
    const u = await abrir();
    const grande = new File(["x"], "g.ics");
    Object.defineProperty(grande, "size", { value: 262145 });
    const leer = vi.fn();
    Object.defineProperty(grande, "text", { value: leer });
    await subir(u, grande);
    expect((await screen.findByTestId("importar-error")).textContent).toContain("demasiado grande");
    expect(leer).not.toHaveBeenCalled();
  });

  it("imp-ac4: un SUMMARY con HTML se ve literal y no crea nodos img", async () => {
    api();
    const u = await abrir();
    const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART;TZID=Europe/Madrid:20270704T100000", "SUMMARY:<img src=x onerror=alert(1)>", "END:VEVENT", "BEGIN:VEVENT", "DTSTART;TZID=Europe/Madrid:20270705T100000", "SUMMARY:Otra", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    await subir(u, fichero(ics));
    expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("imp-ac4: un evento fuera del viaje lo avisa en la lista", async () => {
    api();
    const u = await abrir();
    const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART;TZID=Europe/Madrid:20280101T100000", "SUMMARY:Lejos", "END:VEVENT", "BEGIN:VEVENT", "DTSTART;TZID=Europe/Madrid:20270705T100000", "SUMMARY:Cerca", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    await subir(u, fichero(ics));
    const tarjetas = await screen.findAllByTestId("evento-ics");
    expect(tarjetas[0].textContent).toContain("Esta fecha cae fuera de tu viaje");
    expect(tarjetas[1].textContent).not.toContain("fuera de tu viaje");
  });

  it("imp-ac5: el botón y su ayuda de iPhone y privacidad están visibles; el input acepta .ics", async () => {
    api();
    await abrir();
    expect(screen.getByText(/guárdalo antes en Archivos/)).toBeTruthy();
    expect(screen.getByText("El archivo se lee en tu móvil y no se sube")).toBeTruthy();
    expect(screen.getByTestId("importar-archivo").getAttribute("accept")).toBe(".ics,text/calendar");
  });

  it("imp-ac10: con 30 reservas el botón queda deshabilitado con el aviso del tope", async () => {
    const treinta = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, tipo: "entrada", nombre: `E${i}`, fecha_inicio: "2027-07-04", hora_inicio: "10:00" }) as Reserva);
    api(treinta);
    render(<SeccionReservas planId="plan-1" fechas={FECHAS} />);
    await userEvent.setup().click(screen.getByText("Reservas"));
    const boton = await screen.findByRole("button", { name: "Importar desde archivo" });
    expect(boton).toHaveProperty("disabled", true);
    expect(screen.getByText(/máximo de 30 reservas en este viaje: borra alguna/)).toBeTruthy();
  });

  it("imp-ac10: si se llega al tope a mitad de archivo, la siguiente se sustituye por el aviso", async () => {
    const veintinueve = Array.from({ length: 29 }, (_, i) => ({ id: `e${i}`, tipo: "entrada", nombre: `E${i}`, fecha_inicio: "2027-07-04", hora_inicio: "10:00" }) as Reserva);
    api(veintinueve);
    const u = await abrir();
    await subir(u, fichero(fixture("vuelo-ida-vuelta.ics")));
    await u.click(within((await screen.findAllByTestId("evento-ics"))[0]).getByRole("button", { name: "Usar esta" }));
    await u.selectOptions(screen.getByLabelText("Trayecto"), "ida");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText(/Has llegado al máximo de 30 reservas: las demás del archivo/, {}, { timeout: 15_000 })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Importar la siguiente/ })).toBeNull();
  }, 30_000);

  it("imp-ac7: importar y guardar solo hace peticiones a /reservas, sin el contenido del archivo", async () => {
    const peticiones: { url: string; cuerpo: string }[] = [];
    api();
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      peticiones.push({ url, cuerpo: String(init?.body ?? "") });
      return (base as typeof fetch)(url, init);
    }));
    const u = await abrir();
    await subir(u, fichero(fixture("vuelo-ida-vuelta.ics")));
    await u.click(within((await screen.findAllByTestId("evento-ics"))[0]).getByRole("button", { name: "Usar esta" }));
    await u.selectOptions(screen.getByLabelText("Trayecto"), "ida");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Reserva guardada");
    const posts = peticiones.filter((p) => p.cuerpo !== "");
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("/api/plan/plan-1/reservas");
    expect(peticiones.map((p) => p.url).every((x) => x === "/api/plan/plan-1/reservas")).toBe(true);
    expect(JSON.stringify(peticiones)).not.toMatch(/CENTINELA|pasajero@example\.com/);
  });
});
