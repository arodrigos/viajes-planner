// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnadirSitio } from "../AnadirSitio";
import { TarjetaParada } from "../TarjetaParada";
import type { DiaPublico, ParadaPublica } from "../tiposVista";
import { useSitiosPropios } from "../useSitiosPropios";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const respuesta = (status: number, cuerpo: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });

const DIA = { fecha: "2027-06-10", franjas: [{ id: "manana", etiqueta: "Mañana" }, { id: "tarde", etiqueta: "Tarde" }], paradas: [] } as DiaPublico;

describe("useSitiosPropios (spu-ac1, spu-ac3, spu-ac4)", () => {
  it("la tarjeta provisional aparece al final de la última franja antes de que responda el servidor", async () => {
    let resolver: (r: unknown) => void = () => undefined;
    const fetchMock = vi.fn(() => new Promise((r) => (resolver = r)));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useSitiosPropios("plan-1", 3, 1, DIA, vi.fn()));

    act(() => result.current.anadir("Heladería Fassi", "ir a merendar"));
    expect(result.current.anadidos).toHaveLength(1);
    expect(result.current.anadidos[0]).toMatchObject({ nombre: "Heladería Fassi", nota: "ir a merendar", franja_id: "tarde", propia: true, estadoSitio: "buscando" });
    expect(result.current.aviso?.texto).toBe("Sitio añadido");
    // Hasta que el servidor da el id no hay Deshacer que apunte a nada.
    expect(result.current.aviso?.idExterno).toBeNull();

    // La petición sale de la cola de forma asíncrona: hay que esperar a que exista.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => resolver(respuesta(201, { version: 4, id_externo: "propia-x" })));
    await waitFor(() => expect(result.current.aviso?.idExterno).toBe("propia-x"));
    expect(result.current.anadidos[0].id).toBe("propia-x");
  });

  it("manda el día, la versión base y el nombre; una segunda alta usa la versión que devolvió la primera", async () => {
    const llamadas: { url: string; cuerpo: Record<string, unknown> }[] = [];
    let version = 3;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        llamadas.push({ url, cuerpo: JSON.parse(String(init.body)) });
        version += 1;
        return respuesta(201, { version, id_externo: `p${version}` });
      }),
    );
    const { result } = renderHook(() => useSitiosPropios("plan-1", 3, 1, DIA, vi.fn()));
    act(() => {
      result.current.anadir("Uno", null);
      result.current.anadir("Dos", null);
    });
    await waitFor(() => expect(llamadas).toHaveLength(2));
    expect(llamadas[0]).toEqual({ url: "/api/plan/plan-1/sitios", cuerpo: { dia: 1, nombre: "Uno", nota: null, version_base: 3 } });
    expect(llamadas[1].cuerpo.version_base).toBe(4);
  });

  it("un 409 quita la tarjeta provisional y enseña el texto del servidor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(409, { error: "El plan ha cambiado desde que lo abriste. Recarga y vuelve a intentarlo." })));
    const alActualizar = vi.fn();
    const { result } = renderHook(() => useSitiosPropios("plan-1", 3, 1, DIA, alActualizar));
    act(() => result.current.anadir("Heladería Fassi", null));
    await waitFor(() => expect(result.current.error).toContain("El plan ha cambiado"));
    expect(result.current.anadidos).toHaveLength(0);
    expect(result.current.aviso).toBeNull();
    expect(alActualizar).not.toHaveBeenCalled();
  });

  it("un fallo que no es de los previstos da el mensaje genérico, nunca el crudo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(500, { error: "relation paradas does not exist" })));
    const { result } = renderHook(() => useSitiosPropios("plan-1", 3, 1, DIA, vi.fn()));
    act(() => result.current.anadir("Heladería Fassi", null));
    await waitFor(() => expect(result.current.error).toBe("No se ha podido guardar el sitio."));
  });

  it("corregir cambia el nombre al momento y lo deshace si el servidor lo rechaza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(400, { error: "Solo se pueden cambiar los sitios que añadiste tú" })));
    const { result } = renderHook(() => useSitiosPropios("plan-1", 5, 1, DIA, vi.fn()));
    let hecho: Promise<boolean> = Promise.resolve(true);
    act(() => {
      hecho = result.current.corregir("s1", "Heladería Fassi Roma");
    });
    expect(result.current.corregidos).toEqual({ s1: "Heladería Fassi Roma" });
    expect(await act(() => hecho)).toBe(false);
    expect(result.current.corregidos).toEqual({});
    expect(result.current.error).toContain("Solo se pueden cambiar");
  });

  it("Deshacer quita el alta con la versión que devolvió el POST", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        urls.push(`${init.method} ${url}`);
        return init.method === "POST" ? respuesta(201, { version: 4, id_externo: "propia-x" }) : respuesta(200, { version: 5 });
      }),
    );
    const alActualizar = vi.fn();
    const { result } = renderHook(() => useSitiosPropios("plan-1", 3, 1, DIA, alActualizar));
    act(() => result.current.anadir("Heladería Fassi", null));
    await waitFor(() => expect(result.current.aviso?.idExterno).toBe("propia-x"));
    act(() => result.current.deshacer());
    // La tarjeta desaparece sin esperar al servidor.
    expect(result.current.anadidos).toHaveLength(0);
    await waitFor(() => expect(urls).toContain("DELETE /api/plan/plan-1/sitios/propia-x?version_base=4"));
  });

  it("lo provisional deja de aplicarse cuando llega el día nuevo del servidor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(201, { version: 4, id_externo: "propia-x" })));
    const { result, rerender } = renderHook(({ dia }) => useSitiosPropios("plan-1", 3, 1, dia, vi.fn()), { initialProps: { dia: DIA } });
    act(() => result.current.anadir("Heladería Fassi", null));
    await waitFor(() => expect(result.current.anadidos).toHaveLength(1));
    rerender({ dia: { ...DIA } });
    expect(result.current.anadidos).toHaveLength(0);
  });
});

describe("AnadirSitio (spu-ac6)", () => {
  it("con el nombre vacío no llama y pide el nombre con un ejemplo", () => {
    const onAnadir = vi.fn();
    render(<AnadirSitio onAnadir={onAnadir} />);
    fireEvent.click(screen.getByRole("button", { name: "Añadir un sitio" }));
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe el nombre del sitio, por ejemplo «Heladería Fassi»");
    expect(onAnadir).not.toHaveBeenCalled();
  });

  it("enseña la ayuda, el contador y el aviso de privacidad bajo la nota", () => {
    render(<AnadirSitio onAnadir={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Añadir un sitio" }));
    expect(screen.getByText("Escribe el nombre como sale en el mapa, por ejemplo «Heladería Fassi»")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nota (opcional)"), { target: { value: "ir a merendar" } });
    expect(screen.getByTestId("contador-nota")).toHaveTextContent("13/200");
    expect(screen.getByText(/La verán también quienes tengan acceso a este plan/)).toBeInTheDocument();
  });

  it("entrega el nombre y la nota recortados y se cierra", () => {
    const onAnadir = vi.fn();
    render(<AnadirSitio onAnadir={onAnadir} />);
    fireEvent.click(screen.getByRole("button", { name: "Añadir un sitio" }));
    fireEvent.change(screen.getByLabelText("Nombre del sitio"), { target: { value: "  Heladería Fassi " } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));
    expect(onAnadir).toHaveBeenCalledWith("Heladería Fassi", null);
    expect(screen.getByRole("button", { name: "Añadir un sitio" })).toBeInTheDocument();
  });
});

function tarjeta(extra: Partial<ParadaPublica>, acciones?: { onCorregir: (n: string) => Promise<boolean>; onQuitar: () => Promise<boolean> }) {
  const parada: ParadaPublica = { id: "s1", franja_id: "tarde", nombre: "Heladería Fassi", descripcion: "", procedencia: { fuente: "propuesto-sin-verificar" }, propia: true, ...extra };
  return (
    <ul>
      <TarjetaParada
        planId="plan-1"
        parada={parada}
        franjaId="tarde"
        ciudad="Fez"
        tarjetaRef={() => undefined}
        activa={false}
        solicitudAlternativas={0}
        solicitudGoogle={0}
        hoy="2026-10-08"
        esHoy={false}
        esSiguiente={false}
        visitaEnCurso={false}
        cambiando={null}
        onUsarAlternativa={async () => true}
        onAlternarVisita={() => undefined}
        sitio={acciones}
      />
    </ul>
  );
}

describe("tarjeta de un sitio propio (spu-ac1..ac5)", () => {
  it("buscando: nota y «Buscando…», sin paneles de guía ni ficha", () => {
    const { container } = render(tarjeta({ estadoSitio: "buscando", nota: "ir a merendar" }));
    expect(screen.getByTestId("nota-sitio")).toHaveTextContent("ir a merendar");
    expect(screen.getByText("Buscando… suele tardar unos minutos")).toBeInTheDocument();
    expect(container.querySelectorAll("details")).toHaveLength(0);
  });

  it("resuelto: sin «Buscando…» y con los paneles de cualquier parada", () => {
    const { container } = render(tarjeta({ estadoSitio: "resuelto", nota: "ir a merendar" }));
    expect(screen.queryByText(/Buscando…/)).toBeNull();
    expect(container.querySelectorAll("details").length).toBeGreaterThan(0);
  });

  it("no encontrado: el motivo y «Corregir nombre» guarda el nombre nuevo", async () => {
    const onCorregir = vi.fn(async () => true);
    render(tarjeta({ estadoSitio: "no-encontrado", motivoSitio: "No hemos encontrado «Zzqx» en el mapa de Fez. Revisa cómo se escribe." }, { onCorregir, onQuitar: async () => true }));
    expect(screen.getByTestId("motivo-sitio")).toHaveTextContent("No hemos encontrado «Zzqx»");
    fireEvent.click(screen.getByRole("button", { name: "Corregir nombre" }));
    fireEvent.change(screen.getByLabelText("Nombre del sitio"), { target: { value: "Heladería Fassi" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(onCorregir).toHaveBeenCalledWith("Heladería Fassi");
  });

  it("quitar pide confirmación antes de llamar", () => {
    const onQuitar = vi.fn(async () => true);
    render(tarjeta({ estadoSitio: "buscando" }, { onCorregir: async () => true, onQuitar }));
    fireEvent.click(screen.getByRole("button", { name: "Quitar este sitio" }));
    expect(onQuitar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sí, quitar" }));
    expect(onQuitar).toHaveBeenCalledOnce();
  });

  it("la tarjeta provisional (sin acciones) no ofrece quitar ni corregir", () => {
    render(tarjeta({ estadoSitio: "buscando" }));
    expect(screen.queryByRole("button", { name: "Quitar este sitio" })).toBeNull();
  });

  it("para cualquier nota, se pinta como texto y no crea elementos", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (nota) => {
        const { container, unmount } = render(tarjeta({ estadoSitio: "buscando", nota }));
        const pintada = container.querySelector("[data-testid='nota-sitio']");
        expect(pintada?.children).toHaveLength(0);
        expect(pintada?.textContent).toBe(nota);
        unmount();
      }),
      { numRuns: 50 },
    );
  });
});
