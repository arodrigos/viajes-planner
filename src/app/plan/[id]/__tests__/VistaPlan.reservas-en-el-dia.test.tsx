// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VistaPlan } from "@/app/plan/[id]/VistaPlan";
import type { Reserva } from "@/lib/reservas/tipos";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams("dia=1") }));
vi.mock("@/app/plan/[id]/MapaDia", () => ({ MapaDia: () => <div data-testid="mapa-falso" /> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FECHA = "2027-06-10";
const LLEGADA: Reserva = { id: "v1", tipo: "vuelo", sentido: "ida", fecha_inicio: FECHA, hora_inicio: "08:00", fecha_fin: FECHA, hora_fin: "13:00", origen: "MAD", destino: "FCO", localizador: "ABC123" };
const HOTEL: Reserva = { id: "h1", tipo: "hotel", fecha_inicio: FECHA, fecha_fin: "2027-06-12", nombre: "Hotel Sole", ubicacion: { lat: 41.9, lon: 12.47 } };

function plan(extra: object = {}) {
  return {
    id: "p",
    version: 1,
    destino: "Roma",
    personas: 2,
    dias: [
      {
        fecha: FECHA,
        franjas: [
          { id: "manana", etiqueta: "Mañana", ventana: { desdeMin: 540, hastaMin: 780 } },
          { id: "tarde", etiqueta: "Tarde", ventana: { desdeMin: 900, hastaMin: 1200 } },
        ],
        paradas: [{ id: "a", franja_id: "tarde", nombre: "Foro Romano", descripcion: "d", coordenadas: { lat: 41.89, lon: 12.48 }, procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/1" } }],
      },
    ],
    avisos: [],
    recomendaciones: [],
    regenerando: false,
    trabajoId: "t",
    ...extra,
  };
}

function simular(datosPlan: object, reservas: Reserva[]) {
  const llamadas: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      llamadas.push(url);
      return new Response(JSON.stringify(url.endsWith("/reservas") ? reservas : datosPlan), { status: 200 });
    }),
  );
  return llamadas;
}

describe("reservas en el día (res-dia-ac1)", () => {
  it("el dueño ve la llegada fija con candado y sin controles, y de dónde sale el día", async () => {
    simular(plan(), [LLEGADA, HOTEL]);
    render(<VistaPlan id="p" />);
    const tarjetas = await screen.findAllByTestId("tarjeta-reserva");
    const llegada = tarjetas.find((t) => t.dataset.clase === "llegada")!;
    expect(within(llegada).getByText("Llegada · 13:00")).toBeInTheDocument();
    expect(within(llegada).getByText("MAD → FCO")).toBeInTheDocument();
    expect(within(llegada).queryByRole("button")).toBeNull();
    expect(tarjetas.find((t) => t.dataset.clase === "hotel")).toBeDefined();
    expect(await screen.findByTestId("sales-de")).toHaveTextContent("Sales de: Hotel Sole");
  });

  it("la entrada se pinta en su hora dentro de la franja, tras la parada que acaba antes, con su candado", async () => {
    const entrada: Reserva = { id: "e1", tipo: "entrada", fecha_inicio: FECHA, hora_inicio: "10:30", nombre: "Musei Vaticani" };
    const conManana = plan();
    conManana.dias[0].paradas = [
      { id: "b", franja_id: "manana", nombre: "Basilica di San Pietro", descripcion: "d", coordenadas: { lat: 41.9, lon: 12.45 }, procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/2" }, horario: { inicio: "09:00", fin: "10:00", recortada: false, apertura: "" } },
      ...conManana.dias[0].paradas,
    ] as typeof conManana.dias[0]["paradas"];
    simular(conManana, [entrada]);
    render(<VistaPlan id="p" />);
    const tarjetaEntrada = await screen.findByTestId("tarjeta-reserva");
    expect(within(tarjetaEntrada).getByText("Entrada · 10:30")).toBeInTheDocument();
    expect(tarjetaEntrada.querySelector(".candado-reserva")).not.toBeNull();
    const manana = screen.getByRole("heading", { name: "Mañana" }).closest(".seccion-franja") as HTMLElement;
    const basilica = within(manana).getByText("Basilica di San Pietro").closest("li")!;
    expect(manana.contains(tarjetaEntrada)).toBe(true);
    expect(basilica.compareDocumentPosition(tarjetaEntrada) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sin ubicación del hotel, el día lo explica en vez de inventar un punto de partida", async () => {
    simular(plan(), [{ ...HOTEL, ubicacion: undefined }]);
    render(<VistaPlan id="p" />);
    expect(await screen.findByTestId("ayuda-ubicacion-hotel")).toHaveTextContent("Añade la ubicación del hotel para que el día salga de él");
    expect(screen.queryByTestId("sales-de")).toBeNull();
  });
});

describe("vista compartida con reservas (res-dia-ac5)", () => {
  it("el invitado ve tipo y hora, sin nombres, localizador ni datos del hotel, y no pide las reservas", async () => {
    const llamadas = simular(
      plan({ compartido: { rol: "miembro" }, reservas: [{ id: "v1", tipo: "vuelo", sentido: "ida", fecha: FECHA, hora: "13:00" }, { id: "h1", tipo: "hotel", fecha: FECHA }] }),
      [LLEGADA, HOTEL],
    );
    const { container } = render(<VistaPlan id="p" />);
    await waitFor(() => expect(screen.getAllByTestId("tarjeta-reserva")).toHaveLength(2));
    expect(screen.getByText("Llegada · 13:00")).toBeInTheDocument();
    expect(screen.getByText("Hotel")).toBeInTheDocument();
    for (const secreto of ["MAD", "FCO", "ABC123", "Sole", "Sales de"]) expect(container.textContent).not.toContain(secreto);
    expect(screen.queryByRole("button", { name: /arreglar/i })).toBeNull();
    expect(llamadas.some((u) => u.endsWith("/reservas"))).toBe(false);
  });
});
