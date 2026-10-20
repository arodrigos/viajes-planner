// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VistaPlan } from "@/app/plan/[id]/VistaPlan";
import { CABECERA_REINTENTO } from "@/lib/sinConexion/reglas";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams("dia=1") }));
vi.mock("@/app/plan/[id]/MapaDia", () => ({ MapaDia: () => <div data-testid="mapa-falso" /> }));
vi.mock("@/lib/sinConexion/borrar", () => ({ borrarCopiaPlan: vi.fn(async () => undefined) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const plan = {
  id: "p",
  version: 3,
  destino: "Sevilla",
  personas: 2,
  dias: [
    {
      fecha: "2027-03-05",
      franjas: [{ id: "manana", etiqueta: "Mañana" }],
      paradas: [{ id: "a", franja_id: "manana", nombre: "Sitio a", descripcion: "d", procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/1" }, coordenadas: { lat: 37.38, lon: -5.99 }, alternativas: [] }],
    },
  ],
  avisos: [],
  recomendaciones: [],
  zona: "Europe/Madrid",
};

describe("VistaPlan: la copia con red se cambia sola por la versión fresca", () => {
  it("si la primera lectura llega como copia, reintenta con la cabecera de reintento y quita el aviso sin evento online", async () => {
    const peticiones: Array<Record<string, string> | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
        peticiones.push(init?.headers);
        const reintento = init?.headers?.[CABECERA_REINTENTO] === "1";
        const cabeceras: Record<string, string> = reintento ? { "x-plan-leido-en": "2026-10-20T10:00:00.000Z" } : { "x-plan-leido-en": "2026-10-18T10:00:00.000Z", "x-copia-guardada": "1" };
        return new Response(JSON.stringify(plan), { status: 200, headers: cabeceras });
      }),
    );
    render(<VistaPlan id="p" />);
    await waitFor(() => expect(peticiones.length).toBeGreaterThanOrEqual(2));
    expect(peticiones[0]).toBeUndefined();
    expect(peticiones[1]?.[CABECERA_REINTENTO]).toBe("1");
    await waitFor(() => expect(screen.queryByText(/Sin conexión · Estás viendo la copia guardada/)).toBeNull());
    expect(screen.getByRole("button", { name: /Añadir un sitio/ })).toBeInTheDocument();
  });

  it("si el reintento falla (sin red de verdad) la copia se queda", async () => {
    let llamadas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
        llamadas++;
        if (init?.headers?.[CABECERA_REINTENTO]) throw new TypeError("sin red");
        return new Response(JSON.stringify(plan), { status: 200, headers: { "x-plan-leido-en": "2026-10-18T10:00:00.000Z", "x-copia-guardada": "1" } });
      }),
    );
    render(<VistaPlan id="p" />);
    await waitFor(() => expect(llamadas).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText(/Sin conexión · Estás viendo la copia guardada/)).toBeInTheDocument();
  });
});
