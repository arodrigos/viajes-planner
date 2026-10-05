// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EventosDia, eventosDelDia, SeccionEventos, TEXTO_EVENTOS_EPOCA, TEXTO_EVENTOS_FALLO, TEXTO_EVENTOS_PENDIENTES, TEXTO_EVENTOS_VACIOS } from "@/app/plan/[id]/SeccionEventos";
import type { Evento } from "@/lib/eventos/tipos";

afterEach(cleanup);

const festivo: Evento = { fecha: "2027-06-10", nombre: "Portugal Day", tipo: "festivo", fuente: "openholidays", url: "https://www.openholidaysapi.org/en/", etapa: 0, pais: "PT" };
const escolar: Evento = { fecha: "2027-06-05", fecha_fin: "2027-09-12", nombre: "Summer holidays", tipo: "vacaciones", fuente: "openholidays", url: "https://www.openholidaysapi.org/en/", etapa: 0 };
const fiesta: Evento = { fecha: "2027-06-13", nombre: "Saint Anthony's Day", tipo: "fiesta", fuente: "wikidata", url: "https://www.wikidata.org/wiki/Q112059989", etapa: 0 };

describe("SeccionEventos (eve-ac1, eve-ac2)", () => {
  it("cada evento lleva rótulo, fuente y enlace accesible a su fuente", () => {
    render(<SeccionEventos eventos={{ estado: "consultado", consultado_en: "2027-01-01T00:00:00Z", eventos: [festivo, escolar, fiesta] }} />);
    const item = screen.getAllByTestId("evento")[0]!;
    expect(item).toHaveTextContent("Festivo nacional: Portugal Day · OpenHolidays");
    const enlace = within(item).getByRole("link", { name: "Ver en OpenHolidays: Portugal Day" });
    expect(enlace).toHaveAttribute("href", "https://www.openholidaysapi.org/en/");
    expect(screen.getByRole("link", { name: "Ver en Wikidata: Saint Anthony's Day" })).toHaveAttribute("href", "https://www.wikidata.org/wiki/Q112059989");
  });

  it("eve-ac2: tres estados vacíos distintos y con texto propio", () => {
    const { unmount } = render(<SeccionEventos eventos={{ estado: "epoca", consultado_en: "x", eventos: [] }} />);
    expect(screen.getByText(TEXTO_EVENTOS_EPOCA)).toBeInTheDocument();
    unmount();
    const b = render(<SeccionEventos eventos={{ estado: "consultado", consultado_en: "x", eventos: [] }} />);
    expect(screen.getByText(TEXTO_EVENTOS_VACIOS)).toBeInTheDocument();
    b.unmount();
    const c = render(<SeccionEventos eventos={{ estado: "fallo", consultado_en: "x", eventos: [] }} />);
    expect(screen.getByText(TEXTO_EVENTOS_FALLO)).toBeInTheDocument();
    c.unmount();
    render(<SeccionEventos />);
    expect(screen.getByText(TEXTO_EVENTOS_PENDIENTES)).toBeInTheDocument();
  });

  it("un nombre con marcado se pinta como texto, nunca como elemento", () => {
    const raro: Evento = { ...fiesta, nombre: "x&lt;img src=x onerror=alert(1)&gt;" };
    const { container } = render(<SeccionEventos eventos={{ estado: "consultado", consultado_en: "x", eventos: [raro] }} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("por día: las vacaciones no se repiten y el festivo trae el aviso de museos", () => {
    expect(eventosDelDia([festivo, escolar, fiesta], "2027-06-10")).toEqual([festivo]);
    render(<EventosDia eventos={[festivo]} />);
    expect(screen.getByTestId("eventos-dia")).toHaveTextContent("Algunos museos cierran o cambian de horario en festivo");
  });

  it("día sin eventos no pinta nada", () => {
    const { container } = render(<EventosDia eventos={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
