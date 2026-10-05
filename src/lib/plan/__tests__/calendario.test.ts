import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { franjasComoArray } from "../config-franjas";
import { calcularHorarioDia, minutosDeHora } from "../horario";
import { aPlanPublico } from "../publico";
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

  it("DTSTART/DTEND llevan el rango encadenado de la parada con TZID del lugar (hor-ac1)", () => {
    const { contenido } = generarIcsPlan(planDeDosDias());
    // Catedral (con coordenadas de Toledo): franja de mañana temprano, 07:00 + 90 min, zona Europe/Madrid.
    expect(contenido).toContain("DTSTART;TZID=Europe/Madrid:20261107T070000\r\n");
    expect(contenido).toContain("DTEND;TZID=Europe/Madrid:20261107T083000\r\n");
    expect(contenido).toContain("DTSTART;TZID=Europe/Madrid:20261108T130000\r\n");
  });

  it("una parada sin coordenadas ni caja de ciudad queda en hora flotante, sin inventar zona", () => {
    const { contenido } = generarIcsPlan(planDeDosDias());
    // Mirador: franja de mañana, 09:00 + 60 min.
    expect(contenido).toContain("DTSTART:20261107T090000\r\n");
    expect(contenido).toContain("DTEND:20261107T100000\r\n");
  });

  it("sin coordenadas pero con la caja de la ciudad, la zona sale del centro de la caja", () => {
    const plan = planDeDosDias();
    plan.ciudad = { estado: "resuelta", nombre: "Toledo", caja: { minLat: 39.8, maxLat: 39.9, minLon: -4.1, maxLon: -3.9 } } as Plan["ciudad"];
    const { contenido } = generarIcsPlan(plan);
    expect(contenido).toContain("DTSTART;TZID=Europe/Madrid:20261107T090000\r\n");
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

// Invariante 5: la vista y el .ics salen de la misma función, para
// cualquier plan -- si alguien vuelve a calcular el rango por su cuenta en
// uno de los dos sitios, esto lo pilla.
describe("horario de la vista = horario del .ics (invariante 5)", () => {
  it("para cualquier combinación de duraciones, cada DTSTART/DTEND coincide con el rango de la tarjeta", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 10, max: 200 }), { minLength: 1, maxLength: 5 }), (duraciones) => {
        const plan = planDeDosDias();
        const franjas = franjasComoArray(DESTINO);
        plan.dias = [
          {
            fecha: "2026-11-07",
            franjas,
            paradas: duraciones.map((d, i) => ({
              id: `p${i}`,
              franja_id: "manana",
              nombre: `Sitio ${i}`,
              descripcion: "x",
              duracion_min: d,
              prioridad: 50,
              procedencia: { fuente: "propuesto-sin-verificar" as const },
              coordenadas: { lat: 39.86 + i * 0.003, lon: -4.02 },
            })),
          },
        ];
        const { contenido } = generarIcsPlan(plan);
        const publico = aPlanPublico(plan);
        const horarios = calcularHorarioDia(plan.dias[0]);
        const instantes = [...contenido.matchAll(/^DTSTART;TZID=Europe\/Madrid:\d{8}T(\d{4})00/gm)].map((m) => m[1]);
        const fines = [...contenido.matchAll(/^DTEND;TZID=Europe\/Madrid:\d{8}T(\d{4})00/gm)].map((m) => m[1]);
        publico.dias[0].paradas.forEach((p, i) => {
          expect(p.horario).toMatchObject({ inicio: horarios[p.id].inicio, fin: horarios[p.id].fin });
          expect(instantes[i]).toBe(horarios[p.id].inicio.replace(":", ""));
          expect(fines[i]).toBe(horarios[p.id].fin.replace(":", ""));
          expect(minutosDeHora(horarios[p.id].fin)).toBeLessThanOrEqual(13 * 60);
        });
      }),
    );
  });
});
