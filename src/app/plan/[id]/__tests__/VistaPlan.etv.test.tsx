// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VistaPlan } from "@/app/plan/[id]/VistaPlan";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// maplibre-gl exige WebGL: aquí solo importa qué caja recibe cada día.
vi.mock("@/app/plan/[id]/MapaDia", () => ({
  MapaDia: ({ cajaEtapa }: { cajaEtapa?: { minLat: number } }) => <div data-testid="mapa-falso" data-caja={cajaEtapa ? cajaEtapa.minLat : ""} />,
}));

afterEach(() => {
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
  await waitFor(() => expect(screen.getByText("Sitio a")).toBeInTheDocument());
  return fetchFalso;
}

describe("VistaPlan: Ruta del viaje (etv-ac1, etv-ac2, etv-ac4)", () => {
  it("enseña etapas, traslado, ajustes y cabeceras de día con ciudad", async () => {
    await pintar(multiciudad("tren", ["Quitamos Coímbra: 1 día no deja tiempo para descansar"]));
    const ruta = screen.getByTestId("ruta-viaje");
    expect(within(ruta).getByRole("button", { name: /Lisboa · 1 noche/ })).toBeInTheDocument();
    expect(within(ruta).getByText("Lisboa → Oporto · tren · ~3 h 49 min · ~79 € (estimado)")).toBeInTheDocument();
    expect(within(ruta).getByText("Quitamos Coímbra: 1 día no deja tiempo para descansar")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Día 2 · Oporto" })).toBeInTheDocument();
    expect(screen.queryByText(/No hemos identificado la ciudad/)).toBeNull();
    // El mapa de cada día recibe la caja de SU etapa.
    expect((await screen.findAllByTestId("mapa-falso")).map((m) => m.getAttribute("data-caja"))).toEqual(["38.6", "41.1"]);
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
    expect(screen.getByRole("heading", { name: "2027-06-09" })).toBeInTheDocument();
  });
});
