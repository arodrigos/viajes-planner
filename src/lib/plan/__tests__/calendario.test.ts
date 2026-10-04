import { describe, expect, it } from "vitest";
import { franjasComoArray } from "../config-franjas";
import { generarIcsPlan } from "../calendario";
import type { Plan } from "../tipos";

const DESTINO = "Toledo";

function planDeDosDias(): Plan {
  const franjas = franjasComoArray(DESTINO);
  return {
    id: "plan-ics-1",
    version: 1,
    destino: DESTINO,
    personas: 2,
    dias: [
      {
        fecha: "2026-11-07",
        franjas,
        paradas: [
          {
            id: "parada-a",
            franja_id: franjas[0].id,
            nombre: "Catedral de Toledo",
            descripcion: "Visita guiada",
            duracion_min: 90,
            prioridad: 80,
            procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/way/1" },
            coordenadas: { lat: 39.8578, lon: -4.0226 },
            lugar: { fuente: "osm", id: "osm:way/1", url: "https://www.openstreetmap.org/way/1", nombre_fuente: "Catedral de Toledo", etiquetas: {}, resuelto_en: "2026-11-01T10:00:00.000Z" },
          },
          {
            id: "parada-b",
            franja_id: franjas[1].id,
            nombre: "Mirador del Valle",
            descripcion: "Vista panorámica",
            duracion_min: 60,
            prioridad: 60,
            procedencia: { fuente: "propuesto-sin-verificar" },
          },
        ],
      },
      {
        fecha: "2026-11-08",
        franjas,
        paradas: [
          {
            id: "parada-c",
            franja_id: franjas[2].id,
            nombre: "Sinagoga del Tránsito",
            descripcion: "Museo sefardí",
            duracion_min: 45,
            prioridad: 50,
            procedencia: { fuente: "osm", url: "https://www.openstreetmap.org/node/9" },
            coordenadas: { lat: 39.8541, lon: -4.0254 },
          },
        ],
      },
    ],
  };
}

// ics-ac1: un VEVENT por parada, GEO solo en las resueltas, DTSTART/DTEND
// dentro de la fecha del día y de la ventana de su franja, y la frase de
// horario orientativo en DESCRIPTION.
describe("generarIcsPlan (ics-ac1)", () => {
  it("genera exactamente un VEVENT por parada y un GEO solo en las resueltas", () => {
    const { contenido } = generarIcsPlan(planDeDosDias());
    const numeroEventos = (contenido.match(/BEGIN:VEVENT/g) ?? []).length;
    const numeroGeo = (contenido.match(/^GEO:/gm) ?? []).length;
    expect(numeroEventos).toBe(3);
    expect(numeroGeo).toBe(2);
  });

  it("DTSTART/DTEND son hora flotante (sin Z) dentro de la fecha del día y la ventana de la franja", () => {
    const franjas = franjasComoArray(DESTINO);
    const { contenido } = generarIcsPlan(planDeDosDias());
    expect(contenido).toContain(`DTSTART:20261107T${franjas[0].hora_inicio.replace(":", "")}00\r\n`);
    expect(contenido).toContain(`DTEND:20261107T${franjas[0].hora_fin.replace(":", "")}00\r\n`);
    expect(contenido).toContain(`DTSTART:20261108T${franjas[2].hora_inicio.replace(":", "")}00\r\n`);
  });

  it("SUMMARY es el nombre de la parada y DESCRIPTION trae la frase de horario orientativo", () => {
    const { contenido } = generarIcsPlan(planDeDosDias());
    const descripcionSinSaltos = contenido.replace(/\r\n[ \t]/g, "");
    expect(contenido).toContain("SUMMARY:Catedral de Toledo");
    expect(descripcionSinSaltos).toContain("Horario orientativo según la franja del plan.");
  });

  it("el nombre de fichero es el slug del destino con extensión .ics", () => {
    const { nombreFichero } = generarIcsPlan(planDeDosDias());
    expect(nombreFichero).toBe("toledo.ics");
  });
});
