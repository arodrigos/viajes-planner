// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotonInfografia, ERROR_INFOGRAFIA } from "../BotonInfografia";

const png = () => new Response(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));

describe("BotonInfografia (inf-ac3)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => png()));
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    // @ts-expect-error limpieza de lo que el test define
    delete navigator.share;
    // @ts-expect-error limpieza de lo que el test define
    delete navigator.canShare;
  });

  it("comparte el fichero cuando el navegador lo permite, sin descargar", async () => {
    const share = vi.fn(async () => {});
    Object.assign(navigator, { share, canShare: () => true });
    render(<BotonInfografia planId="p1" />);
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
    render(<BotonInfografia planId="p1" />);
    await userEvent.click(screen.getByRole("button", { name: "Descargar infografía" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sin navigator.share descarga el fichero", async () => {
    render(<BotonInfografia planId="p1" />);
    await userEvent.click(screen.getByRole("button", { name: "Descargar infografía" }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("si la generación falla, enseña el mensaje y el botón sigue disponible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    render(<BotonInfografia planId="p1" />);
    await userEvent.click(screen.getByRole("button", { name: "Descargar infografía" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(ERROR_INFOGRAFIA);
    expect(screen.getByRole("button", { name: "Descargar infografía" })).toBeEnabled();
  });
});
