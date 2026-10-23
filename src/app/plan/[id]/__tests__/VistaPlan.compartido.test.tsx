// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VistaPlan } from "@/app/plan/[id]/VistaPlan";

const { borrarCopiaPlan } = vi.hoisted(() => ({ borrarCopiaPlan: vi.fn(async () => undefined) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams("dia=1") }));
vi.mock("@/app/plan/[id]/MapaDia", () => ({ MapaDia: () => <div data-testid="mapa-falso" /> }));
vi.mock("@/lib/sinConexion/borrar", () => ({ borrarCopiaPlan }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  borrarCopiaPlan.mockClear();
});

const parada = (id: string, extra: object = {}) => ({
  id,
  franja_id: "manana",
  nombre: `Sitio ${id}`,
  descripcion: "d",
  procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/1" },
  coordenadas: { lat: 37.38, lon: -5.99 },
  alternativas: [{ id: "alt", nombre: "Otra", descripcion: "", motivo: "m", procedencia: { fuente: "osm" }, etiquetasEncaje: [] }],
  ...extra,
});

// Mañana del 5 de marzo de 2027 en Sevilla: el día es «hoy», así que también aparecería la tarjeta «Ahora».
const base = {
  id: "p",
  version: 3,
  destino: "Sevilla",
  personas: 2,
  dias: [{ fecha: "2027-03-05", franjas: [{ id: "manana", etiqueta: "Mañana" }], paradas: [parada("a"), parada("propia-1", { propia: true, estadoSitio: "resuelto", nota: "ir a merendar" })] }],
  avisos: [],
  recomendaciones: [],
  zona: "Europe/Madrid",
};

const pintar = async (plan: unknown, estado = 200) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(plan), { status: estado })));
  render(<VistaPlan id="p" />);
};

describe("VistaPlan como invitado (cmu-ac2, cmu-ac6)", () => {
  it("enseña «Compartido contigo · solo lectura», las notas y ningún control de edición ni «Compartir»", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-05T09:00:00Z"));
    try {
      await pintar({ ...base, compartido: { rol: "miembro" } });
      expect(await screen.findByTestId("solo-lectura")).toHaveTextContent("Compartido contigo · solo lectura");
      expect(screen.getByText("ir a merendar")).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(2);
      for (const nombre of [/Regenerar/, /Subir/, /Bajar/, /Optimizar orden/, /Añadir un sitio/, /Corregir nombre/, /Quitar este sitio/, /Alternativas/, /Marcar/, /Comprobar en Google|Google/, /Compartir/]) {
        expect(screen.queryByRole("button", { name: nombre })).toBeNull();
      }
      expect(screen.queryByText(/Alternativas \(/)).toBeNull();
      expect(screen.queryByText("Compartir")).toBeNull();
      expect(screen.queryByRole("region", { name: "Ahora" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("el dueño sí ve «Compartir» y no la cabecera de solo lectura", async () => {
    await pintar({ ...base, regenerando: false, trabajoId: "t" });
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
    expect(screen.getByText("Compartir")).toBeInTheDocument();
    expect(screen.queryByTestId("solo-lectura")).toBeNull();
  });

  it("inv-ac1: para el invitado la primera parada va antes que el mapa, «Cómo leer» y «Guardar mapas»", async () => {
    await pintar({ ...base, compartido: { rol: "miembro" } });
    await screen.findByTestId("solo-lectura");
    const primera = document.querySelector("li.tarjeta-parada")!;
    const despues = [screen.getByTestId("mapa-falso"), screen.getByText("Cómo leer este plan"), screen.getByText(/Guardar mapas/)];
    for (const el of despues) expect(primera.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("el dueño conserva el mapa y «Cómo leer» antes del itinerario", async () => {
    await pintar({ ...base });
    await waitFor(() => expect(screen.getByTestId("mapa-falso")).toBeInTheDocument());
    const primera = document.querySelector("li.tarjeta-parada")!;
    expect(primera.compareDocumentPosition(screen.getByTestId("mapa-falso")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(primera.compareDocumentPosition(screen.getByText("Cómo leer este plan")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("un plan multiciudad compartido no pinta importes en la ruta (sin NaN)", async () => {
    const caja = { minLat: 38.6, maxLat: 38.8, minLon: -9.2, maxLon: -9 };
    await pintar({
      ...base,
      dias: [base.dias[0], { ...base.dias[0], fecha: "2027-03-06", etapa: 1, paradas: [parada("b")] }],
      etapas: [
        { ciudad: { estado: "resuelta", nombre: "Lisboa", caja, intentado_en: "x" }, pais: "Portugal", dias: 1, dia_inicio: 0, zona: 0, ajustes: [] },
        { ciudad: { estado: "resuelta", nombre: "Oporto", caja, intentado_en: "x" }, pais: "Portugal", dias: 1, dia_inicio: 1, zona: 0, ajustes: [] },
      ],
      traslados: [{ desde: "Lisboa", hasta: "Oporto", modo: "tren", distancia_km: 313, duracion_min: 229, procedencia: "estimado" }],
      compartido: { rol: "miembro" },
    });
    await screen.findByTestId("solo-lectura");
    screen.getByRole("link", { name: /Resumen/ }).click();
    const ruta = await screen.findByTestId("ruta-viaje");
    expect(ruta.textContent).toContain("Lisboa → Oporto · tren · ~3 h 49 min");
    expect(ruta.textContent).not.toMatch(/NaN|undefined|€/);
    expect(screen.queryByTestId("presupuesto-ruta")).toBeNull();
  });
});

describe("VistaPlan: acceso retirado (cmu-ac4)", () => {
  it("un 404 con red borra la copia del plan y su mapa y lo explica con un enlace a Mis viajes", async () => {
    await pintar({ error: "no encontrado" }, 404);
    expect(await screen.findByTestId("acceso-retirado")).toHaveTextContent("Ya no tienes acceso a este plan. Quien lo creó ha dejado de compartirlo.");
    expect(screen.getByRole("link", { name: "Ir a Mis viajes" })).toHaveAttribute("href", "/viajes");
    expect(borrarCopiaPlan).toHaveBeenCalledWith("p");
    expect(screen.queryByText("Cargando el plan…")).toBeNull();
  });

  it("un 500 no borra la copia: sin saber si hay acceso, se conserva", async () => {
    await pintar({ error: "x" }, 500);
    await screen.findByRole("alert");
    expect(borrarCopiaPlan).not.toHaveBeenCalled();
  });
});
