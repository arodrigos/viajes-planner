import { describe, expect, it } from "vitest";
import type { Plan } from "@/lib/plan/tipos";
import { resolverPlan } from "../resolverPlan";
import { crearFuenteLugaresGrabada } from "../fuenteGrabada";
import type { CandidatoLugar } from "../tipos";

const BBOX_MADRID = { minLat: 40.3119774, maxLat: 40.6437293, minLon: -3.8889539, maxLon: -3.5183264 };

function candidatoReal(parcial: Partial<CandidatoLugar> & Pick<CandidatoLugar, "nombreFuente" | "lat" | "lon">): CandidatoLugar {
  return { fuente: "osm", id: "osm:way/1", url: "https://www.openstreetmap.org/way/1", nombresAlternativos: [], etiquetas: {}, ...parcial };
}

function plan(): Plan {
  return {
    id: "plan-lug-ac1",
    version: 1,
    destino: "Madrid",
    personas: 2,
    dias: [
      {
        fecha: "2026-11-07",
        franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
        paradas: [
          { id: "p1", franja_id: "manana", nombre: "Museo del Prado", descripcion: "Pinacoteca", duracion_min: 120, prioridad: 80, procedencia: { fuente: "propuesto-sin-verificar" }, categoria: "museo" },
          { id: "p2", franja_id: "manana", nombre: "Monasterio Perdido Inventado", descripcion: "No existe", duracion_min: 60, prioridad: 50, procedencia: { fuente: "propuesto-sin-verificar" }, categoria: "monumento" },
          { id: "p3", franja_id: "manana", nombre: "Templo de Debod", descripcion: "Templo egipcio", duracion_min: 60, prioridad: 60, procedencia: { fuente: "propuesto-sin-verificar" }, categoria: "monumento" },
        ],
      },
    ],
  };
}

describe("resolverPlan (lug-ac1)", () => {
  it("resuelve por Nominatim, por respaldo de Wikipedia, y deja sin resolver lo que no encaja -- el plan se guarda completo en los tres casos", async () => {
    const fuente = crearFuenteLugaresGrabada({
      destinos: { Madrid: BBOX_MADRID },
      nominatim: {
        "Museo del Prado::Madrid": [candidatoReal({ nombreFuente: "Museo del Prado", lat: 40.4137925, lon: -3.6920407, categoriaOsm: "tourism" })],
        "Monasterio Perdido Inventado::Madrid": [],
        "Templo de Debod::Madrid": [],
      },
      wikipedia: {
        "Templo de Debod::Madrid": [candidatoReal({ fuente: "wikipedia", id: "wikipedia:es:Templo_de_Debod", url: "https://es.wikipedia.org/wiki/Templo_de_Debod", nombreFuente: "Templo de Debod", lat: 40.4238, lon: -3.7175 })],
        "Monasterio Perdido Inventado::Madrid": [],
      },
    });

    const resuelto = await resolverPlan(fuente, plan());
    const [prado, monasterio, debod] = resuelto.dias[0].paradas;

    expect(prado.coordenadas).toEqual({ lat: 40.4137925, lon: -3.6920407 });
    expect(prado.lugar?.fuente).toBe("osm");
    expect(prado.resolucion?.estado).toBe("resuelta");

    expect(monasterio.coordenadas).toBeUndefined();
    expect(monasterio.resolucion?.estado).toBe("no-resuelta");
    expect(monasterio.resolucion?.motivo).toBeTruthy();

    expect(debod.coordenadas).toEqual({ lat: 40.4238, lon: -3.7175 });
    expect(debod.lugar?.fuente).toBe("wikipedia");
    expect(debod.resolucion?.estado).toBe("resuelta");

    // El plan entero sigue teniendo sus 3 paradas: nada se cae por no resolver.
    expect(resuelto.dias[0].paradas).toHaveLength(3);
  });

  it("si no se puede geocodificar el destino, todas las paradas quedan en error sin hacer fallar el plan", async () => {
    const fuente = crearFuenteLugaresGrabada({ destinos: {}, nominatim: {} });
    const resuelto = await resolverPlan(fuente, plan());
    for (const parada of resuelto.dias[0].paradas) {
      expect(parada.resolucion?.estado).toBe("error");
    }
    expect(resuelto.dias[0].paradas).toHaveLength(3);
  });
});
