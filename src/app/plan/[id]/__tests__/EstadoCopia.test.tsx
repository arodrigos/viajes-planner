// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EstadoCopia, FranjaCopia } from "@/app/plan/[id]/EstadoCopia";

const ID = "12345678-1234-4234-8234-123456789abc";
const LEIDO = "2026-10-18T10:05:00.000Z";

function simularCaches(claves: string[]) {
  const cache = { keys: async () => claves.map((c) => new Request(`http://localhost${c}`)) };
  vi.stubGlobal("caches", { has: async () => true, open: async () => cache });
}

function simularSW(controlando: boolean) {
  Object.defineProperty(navigator, "serviceWorker", { value: { controller: controlando ? {} : null }, configurable: true });
}

beforeEach(() => vi.useRealTimers());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("EstadoCopia (sc-ac11)", () => {
  it("con SW controlando y la copia en viajes-datos enseña la línea con la hora", async () => {
    simularSW(true);
    simularCaches([`/api/plan/${ID}`]);
    render(<EstadoCopia planId={ID} leidoEn={LEIDO} />);
    const hora = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(LEIDO));
    expect(await screen.findByText(new RegExp(`Disponible sin conexión · guardado a las ${hora}`))).toBeTruthy();
  });

  it("sin SW (serviceWorkers 'block') no promete nada", async () => {
    simularSW(false);
    simularCaches([`/api/plan/${ID}`]);
    const { container } = render(<EstadoCopia planId={ID} leidoEn={LEIDO} />);
    await new Promise((r) => setTimeout(r, 700));
    expect(container.textContent).toBe("");
  });

  it("con SW pero sin la copia de este plan en la caché no promete nada", async () => {
    simularSW(true);
    simularCaches([`/api/plan/00000000-0000-4000-8000-000000000000`]);
    const { container } = render(<EstadoCopia planId={ID} leidoEn={LEIDO} />);
    await new Promise((r) => setTimeout(r, 700));
    expect(container.textContent).toBe("");
  });

  it("en iPhone fuera de la app instalada añade la nota de abrirlo desde la app", async () => {
    simularSW(true);
    simularCaches([`/api/plan/${ID}`]);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
    Object.defineProperty(navigator, "standalone", { value: false, configurable: true });
    render(<EstadoCopia planId={ID} leidoEn={LEIDO} />);
    await waitFor(() => expect(screen.getByText(/En iPhone, ábrelo una vez desde la app instalada antes de viajar/)).toBeTruthy());
    Reflect.deleteProperty(navigator, "standalone");
  });

  it("instalada en iPhone (standalone true) no añade la nota", async () => {
    simularSW(true);
    simularCaches([`/api/plan/${ID}`]);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
    Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    render(<EstadoCopia planId={ID} leidoEn={LEIDO} />);
    await screen.findByText(/Disponible sin conexión/);
    expect(screen.queryByText(/En iPhone/)).toBeNull();
    Reflect.deleteProperty(navigator, "standalone");
  });
});

describe("FranjaCopia", () => {
  it("es role=status, con día y hora de la copia, sin la palabra offline", () => {
    render(<FranjaCopia leidoEn={LEIDO} />);
    const franja = screen.getByRole("status");
    expect(franja.textContent).toMatch(/^Sin conexión · Estás viendo la copia guardada el .+ a las \d{2}:\d{2}\. Se actualizará sola cuando vuelva la conexión\.$/);
    expect(franja.textContent).not.toMatch(/offline/i);
  });
});
