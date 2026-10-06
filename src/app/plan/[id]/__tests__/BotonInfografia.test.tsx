// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotonInfografia, ERROR_INFOGRAFIA } from "../BotonInfografia";

// Respuesta mínima en vez de `Response` real: en jsdom mezcla el Blob de jsdom con el
// de undici y el tiempo de leerlo variaba entre entornos.
const png = () => ({
  ok: true,
  status: 200,
  blob: async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }),
});

describe("BotonInfografia (inf-ac3)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => png()));
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    // jsdom no implementa la navegación del enlace de descarga: sin esto el clic
    // depende de cómo cada entorno trate ese aviso.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // @ts-expect-error limpieza de lo que el test define
    delete navigator.share;
    // @ts-expect-error limpieza de lo que el test define
    delete navigator.canShare;
  });

  it("comparte el fichero cuando el navegador lo permite, sin descargar", async () => {
    const share = vi.fn(async () => {});
    Object.assign(navigator, { share, canShare: () => true });
    render(<BotonInfografia planId="p1" version={1} />);
    await userEvent.click(screen.getByRole("button", { name: "Descargar infografía" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect((share.mock.calls[0] as unknown as [{ files: File[] }])[0].files[0].type).toBe("image/png");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("cancelar el diálogo de compartir no enseña ningún error", async () => {
    const share = vi.fn(async () => {
      throw new DOMException("cancelado", "AbortError");
    });
    Object.assign(navigator, { share, canShare: () => true });
    render(<BotonInfografia planId="p1" version={1} />);
    await userEvent.click(screen.getByRole("button", { name: "Descargar infografía" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sin navigator.share descarga el fichero", async () => {
    render(<BotonInfografia planId="p1" version={1} />);
    await userEvent.click(screen.getByRole("button", { name: "Descargar infografía" }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1), { timeout: 15000 });
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("si la generación falla, enseña el mensaje y el botón sigue disponible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, blob: async () => new Blob([]) })));
    render(<BotonInfografia planId="p1" version={1} />);
    await userEvent.click(screen.getByRole("button", { name: "Descargar infografía" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_INFOGRAFIA);
    expect(screen.getByRole("button", { name: "Descargar infografía" })).toBeEnabled();
  });

  it("la previa no pide nada hasta pulsar «Ver infografía» y usa la versión en la URL", async () => {
    render(<BotonInfografia planId="p1" version={3} />);
    expect(screen.queryByRole("img")).toBeNull();
    const boton = screen.getByRole("button", { name: "Ver infografía" });
    expect(boton).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(boton);
    expect(boton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Preparando la infografía…");
    const imagen = document.querySelector("img") as HTMLImageElement;
    expect(imagen.getAttribute("src")).toBe("/api/plan/p1/infografia.png?v=3");
    expect(imagen.alt).toBe("Infografía del viaje");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("al cargar la imagen desaparece el marcador, y cerrar y abrir no cambia la URL", async () => {
    render(<BotonInfografia planId="p1" version={1} />);
    const boton = screen.getByRole("button", { name: "Ver infografía" });
    await userEvent.click(boton);
    const imagen = document.querySelector("img") as HTMLImageElement;
    fireEvent.load(imagen);
    expect(screen.queryByRole("status")).toBeNull();
    await userEvent.click(boton);
    expect(boton).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("figure")).toHaveAttribute("hidden");
    await userEvent.click(boton);
    expect(document.querySelector("img")).toBe(imagen);
  });

  it("si la previa falla enseña el error y «Reintentar» pide la imagen con &r=1", async () => {
    render(<BotonInfografia planId="p1" version={1} />);
    await userEvent.click(screen.getByRole("button", { name: "Ver infografía" }));
    fireEvent.error(document.querySelector("img") as HTMLImageElement);
    expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_INFOGRAFIA);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect((document.querySelector("img") as HTMLImageElement).getAttribute("src")).toBe("/api/plan/p1/infografia.png?v=1&r=1");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
