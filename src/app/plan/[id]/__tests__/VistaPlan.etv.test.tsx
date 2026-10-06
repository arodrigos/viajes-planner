// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VistaPlan } from "@/app/plan/[id]/VistaPlan";

const { busqueda } = vi.hoisted(() => ({ busqueda: { valor: "dia=resumen" } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(busqueda.valor) }));
// maplibre-gl exige WebGL: aquí solo importa qué caja recibe cada día.
vi.mock("@/app/plan/[id]/MapaDia", () => ({
  MapaDia: ({ cajaEtapa }: { cajaEtapa?: { minLat: number } }) => <div data-testid="mapa-falso" data-caja={cajaEtapa ? cajaEtapa.minLat : ""} />,
}));

afterEach(() => {
  busqueda.valor = "dia=resumen";
  cleanup();
  vi.unstubAllGlobals();
});

const caja = (lat: number) => ({ minLat: lat, maxLat: lat + 0.2, minLon: -9, maxLon: -8.8 });
const parada = (id: string) => ({ id, franja_id: "manana", nombre: `Sitio ${id}`, descripcion: "d", procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/1" } });

function multiciudad(modo: "tren" | "coche", ajustes: string[] = []) {
  return {
    id: "p",
    version: 1,
    destino: "Portugal",
    personas: 4,
    dias: [
      { fecha: "2027-06-08", etapa: 0, franjas: [{ id: "manana", etiqueta: "Mañana" }], paradas: [parada("a")] },
      { fecha: "2027-06-09", etapa: 1, franjas: [{ id: "manana", etiqueta: "Mañana" }], paradas: [parada("b")] },
    ],
    avisos: [],
    recomendaciones: [],
    ciudad: { estado: "multiciudad", intentado_en: "2026-10-05" },
    etapas: [
      { ciudad: { estado: "resuelta", nombre: "Lisboa", caja: caja(38.6), intentado_en: "x" }, pais: "Portugal", dias: 1, dia_inicio: 0, motivo: "Capital", alojamiento_noche_eur: 90, zona: 0, ajustes },
      { ciudad: { estado: "resuelta", nombre: "Oporto", caja: caja(41.1), intentado_en: "x" }, pais: "Portugal", dias: 1, dia_inicio: 1, alojamiento_noche_eur: 80, zona: 0, ajustes: [] },
    ],
    traslados: [{ desde: "Lisboa", hasta: "Oporto", modo, distancia_km: 313, duracion_min: 229, coste_eur: 79, procedencia: "estimado" }],
    presupuesto: { total_eur: 169, total_estimado_eur: 169, total_de_fuente_eur: 0, alojamiento_eur: 90, traslados_eur: 79, actividades_eur: 0, tu_presupuesto_eur: 3000 },
    regenerando: false,
    trabajoId: "t",
  };
}

async function pintar(plan: unknown, fetchFalso = vi.fn(async () => new Response(JSON.stringify(plan), { status: 200 }))) {
  vi.stubGlobal("fetch", fetchFalso);
  render(<VistaPlan id="p" />);
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  return fetchFalso;
}

describe("VistaPlan: Ruta del viaje (etv-ac1, etv-ac2, etv-ac4)", () => {
  it("enseña etapas, traslado, ajustes y cabeceras de día con ciudad", async () => {
    await pintar(multiciudad("tren", ["Quitamos Coímbra: 1 día no deja tiempo para descansar"]));
    const ruta = screen.getByTestId("ruta-viaje");
    expect(within(ruta).getByRole("button", { name: /Lisboa · 1 noche/ })).toBeInTheDocument();
    expect(within(ruta).getByText("Lisboa → Oporto · tren · ~3 h 49 min · ~79 € (estimado)")).toBeInTheDocument();
    expect(within(ruta).getByText("Quitamos Coímbra: 1 día no deja tiempo para descansar")).toBeInTheDocument();
    expect(screen.queryByText(/No hemos identificado la ciudad/)).toBeNull();
  });

  it("el día de una etapa nombra su ciudad y su mapa recibe la caja de SU etapa", async () => {
    busqueda.valor = "dia=2";
    await pintar(multiciudad("tren"));
    expect(screen.getByRole("heading", { name: /^Día 2 · .* · Oporto$/ })).toBeInTheDocument();
    expect((await screen.findAllByTestId("mapa-falso")).map((m) => m.getAttribute("data-caja"))).toEqual(["41.1"]);
  });

  it("elegir un día desde la ruta del resumen cambia de panel con un solo mapa", async () => {
    await pintar(multiciudad("tren"));
    expect(screen.queryAllByTestId("mapa-falso")).toHaveLength(0);
    await userEvent.click(within(screen.getByTestId("ruta-viaje")).getByRole("button", { name: /Lisboa · 1 noche/ }));
    expect(await screen.findByText("Sitio a")).toBeInTheDocument();
    expect(screen.getAllByTestId("mapa-falso")).toHaveLength(1);
  });

  it("sin ajustes dice que el reparto cumple las reglas", async () => {
    await pintar(multiciudad("tren"));
    expect(screen.getByText("El reparto cumple las reglas de descanso sin ajustes")).toBeInTheDocument();
  });

  it("el traslado en tren tiene 2 enlaces seguros y en coche ninguno", async () => {
    await pintar(multiciudad("tren"));
    const enlaces = within(screen.getByTestId("traslado-ruta")).getAllByRole("link");
    expect(enlaces).toHaveLength(2);
    for (const e of enlaces) {
      expect(e.getAttribute("target")).toBe("_blank");
      expect(e.getAttribute("rel")).toContain("noopener");
      expect(e.getAttribute("rel")).toContain("noreferrer");
    }
    expect(screen.getByRole("link", { name: "Buscar tren Lisboa → Oporto" })).toHaveAttribute("href", expect.stringContaining("2027-06-09"));
    cleanup();
    await pintar(multiciudad("coche"));
    expect(within(screen.getByTestId("traslado-ruta")).queryAllByRole("link")).toHaveLength(0);
  });

  it("pintar la ruta no hace más peticiones que la del plan", async () => {
    const fetchFalso = await pintar(multiciudad("tren"));
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("un plan sin etapas no pinta Ruta del viaje y su cabecera de día es la fecha", async () => {
    const plan = { ...multiciudad("tren"), etapas: undefined, traslados: undefined, ciudad: undefined, dias: multiciudad("tren").dias.map((d) => ({ ...d, etapa: undefined })) };
    await pintar(plan);
    expect(screen.queryByTestId("ruta-viaje")).toBeNull();
    busqueda.valor = "dia=2";
    cleanup();
    await pintar(plan);
    expect(screen.getByRole("heading", { name: /^Día 2 · .* 9 jun$/ })).toBeInTheDocument();
    expect(screen.queryByText("2027-06-09")).toBeNull();
  });
});
