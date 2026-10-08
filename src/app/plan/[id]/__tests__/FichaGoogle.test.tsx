// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FichaGoogle } from "@/app/plan/[id]/FichaGoogle";
import type { EstadoGoogleParada } from "@/lib/google/estados";
import { TEXTO_MENSAJE_FICHA } from "@/lib/google/estadoFicha";

const mocks = vi.hoisted(() => ({ clave: null as string | null, importLibrary: vi.fn(async () => ({})), setOptions: vi.fn() }));

// El script de Google es la única frontera externa: se sustituye por un
// espía. Lo demás (fetch a la ruta, estados, DOM) es el código real.
vi.mock("@/lib/google/claveNavegador", () => ({ claveNavegador: () => mocks.clave }));
vi.mock("@googlemaps/js-api-loader", () => ({ importLibrary: mocks.importLibrary, setOptions: mocks.setOptions }));

const HREF = "https://www.google.com/maps/search/?api=1&query=38.7,-9.1";

type Respuesta = { status: number; cuerpo: unknown };
let respuestas: Respuesta[];
let posts: unknown[];

beforeEach(() => {
  mocks.clave = "clave-de-prueba-ci";
  mocks.importLibrary.mockClear();
  mocks.setOptions.mockClear();
  respuestas = [{ status: 200, cuerpo: { placeId: "ChIJ-prueba-1" } }];
  posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      posts.push(JSON.parse(init.body));
      const r = respuestas.length > 1 ? respuestas.shift()! : respuestas[0];
      return new Response(JSON.stringify(r.cuerpo), { status: r.status });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ficha(estado: EstadoGoogleParada | undefined, abierto: boolean) {
  return <FichaGoogle planId="plan-1" paradaId="p1" estado={estado} abierto={abierto} hrefMaps={HREF} />;
}

describe("FichaGoogle sin clave de navegador (fic-ac7)", () => {
  it.each([null, ""])("clave %j: mensaje del catálogo, enlace a Maps y ninguna llamada", async (valor) => {
    mocks.clave = valor === "" ? null : valor;
    const { container, rerender } = render(ficha("casado", false));
    rerender(ficha("casado", true));
    rerender(ficha("casado", false));
    rerender(ficha("casado", true));
    expect(await screen.findByText(TEXTO_MENSAJE_FICHA.sinClave)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Abrir en Google Maps" }).getAttribute("href")).toBe(HREF);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.importLibrary).not.toHaveBeenCalled();
    expect(container.querySelector("gmp-place-details")).toBeNull();
  });

  it.each([
    ["sin-ubicacion", "sinUbicacion"],
    ["pendiente", "pendiente"],
    ["sin-coincidencia", "sinCoincidencia"],
  ] as const)("una parada %s enseña su propio mensaje, no el de sin clave", async (estado, mensaje) => {
    mocks.clave = null;
    render(ficha(estado, true));
    expect(await screen.findByText(TEXTO_MENSAJE_FICHA[mensaje])).toBeTruthy();
    expect(screen.queryByText(TEXTO_MENSAJE_FICHA.sinClave)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.importLibrary).not.toHaveBeenCalled();
  });
});

describe("FichaGoogle con clave", () => {
  it("antes de abrir no pide nada", () => {
    render(ficha("casado", false));
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.importLibrary).not.toHaveBeenCalled();
  });

  it("parada casada: un POST, la ficha con su place_id y sin precio; reabrir no repite (fic-ac1)", async () => {
    const { container, rerender } = render(ficha("casado", true));
    await waitFor(() => expect(container.querySelector("gmp-place-details")).not.toBeNull());
    expect(posts).toEqual([{ planId: "plan-1", paradaId: "p1" }]);
    expect(container.querySelector("gmp-place-details-place-request")?.getAttribute("place")).toBe("ChIJ-prueba-1");
    expect(container.querySelector("gmp-place-content-config")).not.toBeNull();
    expect(container.querySelector("gmp-place-price")).toBeNull();
    expect(container.querySelector("gmp-place-reviews")).not.toBeNull();
    expect(container.querySelector("gmp-place-attribution")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Qué datos salen" }).getAttribute("href")).toBe("/privacidad");
    expect(mocks.setOptions).toHaveBeenCalledWith({ key: "clave-de-prueba-ci", v: "weekly", language: "es" });

    rerender(ficha("casado", false));
    rerender(ficha("casado", true));
    expect(posts).toHaveLength(1);
    expect(container.querySelectorAll("gmp-place-details")).toHaveLength(1);
  });

  it("gmp-load deja la ficha a la vista", async () => {
    const { container } = render(ficha("casado", true));
    await waitFor(() => expect(container.querySelector("gmp-place-details")).not.toBeNull());
    expect((container.querySelector("gmp-place-details")!.parentElement as HTMLElement).hidden).toBe(true);
    act(() => void container.querySelector("gmp-place-details")!.dispatchEvent(new Event("gmp-load")));
    await waitFor(() => expect((container.querySelector("gmp-place-details")!.parentElement as HTMLElement).hidden).toBe(false));
  });

  it("429: mensaje de cupo, enlace a Maps y ningún elemento (fic-ac3)", async () => {
    respuestas = [{ status: 429, cuerpo: { motivo: "cupo-agotado" } }];
    const { container } = render(ficha("casado", true));
    expect(await screen.findByText(TEXTO_MENSAJE_FICHA.cupoAgotado)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Abrir en Google Maps" })).toBeTruthy();
    expect(container.querySelector("gmp-place-details")).toBeNull();
    expect(mocks.importLibrary).not.toHaveBeenCalled();
  });

  it.each([
    ["sin-ubicacion", "sinUbicacion"],
    ["pendiente", "pendiente"],
    ["sin-coincidencia", "sinCoincidencia"],
  ] as const)("estado %s: su mensaje y ningún POST (fic-ac3)", async (estado, mensaje) => {
    render(ficha(estado, true));
    expect(await screen.findByText(TEXTO_MENSAJE_FICHA[mensaje])).toBeTruthy();
    expect(screen.getByRole("link", { name: "Abrir en Google Maps" })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("gmp-requesterror NOT_FOUND: avisa de obsoleto, muestra error y Reintentar hace otro POST (fic-ac3, fic-ac6)", async () => {
    const { container } = render(ficha("casado", true));
    await waitFor(() => expect(container.querySelector("gmp-place-details")).not.toBeNull());
    const fallo = Object.assign(new Event("gmp-requesterror"), { error: { code: "NOT_FOUND" } });
    act(() => void container.querySelector("gmp-place-details")!.dispatchEvent(fallo));

    expect((await screen.findByRole("alert")).textContent).toBe(TEXTO_MENSAJE_FICHA.errorGoogle);
    expect(posts).toContainEqual({ planId: "plan-1", paradaId: "p1", obsoleto: true });

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(container.querySelector("gmp-place-details")).not.toBeNull());
    expect(posts.filter((p) => !(p as { obsoleto?: boolean }).obsoleto)).toHaveLength(2);
  });
});

const ESTADOS = ["sin-ubicacion", "pendiente", "sin-coincidencia", "casado", undefined] as const;
const STATUS = [200, 404, 429, 401, 500] as const;

describe("invariantes de FichaGoogle (property tests)", () => {
  it("para cualquier secuencia de aperturas y cierres hay como mucho un POST", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), async (secuencia) => {
        cleanup();
        posts = [];
        const { rerender } = render(ficha("casado", false));
        for (const abierto of secuencia) rerender(ficha("casado", abierto));
        await act(async () => {});
        expect(posts.length).toBeLessThanOrEqual(1);
      }),
      { numRuns: 25 },
    );
  });

  it("para cualquier estado y respuesta, el panel muestra un mensaje o la ficha, nunca los dos ni ninguno", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ESTADOS), fc.constantFrom(...STATUS), async (estado, status) => {
        cleanup();
        respuestas = [{ status, cuerpo: status === 200 ? { placeId: "ChIJ-x" } : { motivo: "sin-ficha" } }];
        const { container } = render(ficha(estado, true));
        await waitFor(() => {
          const mensajes = container.querySelectorAll("p.ayuda, p.mensaje-error");
          const privacidad = container.querySelector("a[href='/privacidad']") ? 1 : 0;
          const hayFicha = container.querySelector("gmp-place-details") ? 1 : 0;
          const textos = mensajes.length - privacidad;
          expect(textos + hayFicha).toBe(1);
        });
        const hayFicha = container.querySelector("gmp-place-details") !== null;
        if (hayFicha) expect(container.querySelector("p.mensaje-error")).toBeNull();
      }),
      { numRuns: 30 },
    );
  });
});
