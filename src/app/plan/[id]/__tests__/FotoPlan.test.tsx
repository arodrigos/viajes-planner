// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FotoPlan } from "../FotoPlan";

describe("FotoPlan (fsd-ac1, fsd-ac3)", () => {
  it("con navigator.onLine true, un error de carga pinta el hueco accesible y avisa al padre", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const alFallar = vi.fn();
    const { container } = render(<FotoPlan src="https://upload.wikimedia.org/x.jpg" alt="Museo" className="foto-parada" alFallar={alFallar} />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    const hueco = screen.getByRole("img", { name: "Foto no disponible sin conexión" });
    expect(hueco.getAttribute("data-foto-estado")).toBe("no-disponible");
    expect(container.querySelector("img")).toBeNull();
    expect(alFallar).toHaveBeenCalledTimes(1);
  });

  it("sin error, la imagen se queda como estaba", () => {
    const { container } = render(<FotoPlan src="https://upload.wikimedia.org/x.jpg" alt="Museo" className="foto-parada" />);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("Museo");
    expect(container.querySelector("[data-foto-estado]")).toBeNull();
  });
});
