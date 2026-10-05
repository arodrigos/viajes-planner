// etv-ac4: enlaces salientes para buscar el transporte de un traslado. No hay
// integración: son URLs que se construyen en la vista y abre el viajero, sin
// ninguna petición del servidor. Siempre sobre una base fija y con
// URLSearchParams, nunca concatenando: el nombre de una ciudad lo propone el
// modelo y podría traer «&», «#» o «javascript:».
import type { TrasladoPlan } from "@/lib/plan/tipos";

export interface EnlaceTransporte {
  etiqueta: string;
  // Texto para lectores de pantalla: el medio y las dos ciudades.
  nombreAccesible: string;
  href: string;
}

export interface PaisesTraslado {
  origen?: string;
  destino?: string;
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function urlGoogle(ruta: string, parametros: Record<string, string>): string {
  const url = new URL(ruta, "https://www.google.com");
  for (const [clave, valor] of Object.entries(parametros)) url.searchParams.set(clave, valor);
  return url.toString();
}

function conPais(ciudad: string, pais: string | undefined): string {
  return pais ? `${ciudad}, ${pais}` : ciudad;
}

// `fecha` es la del primer día de la etapa de destino; en un plan en modo
// época no hay fecha concreta y se omite de la búsqueda en vez de inventarla.
export function enlacesTransporte(traslado: Pick<TrasladoPlan, "desde" | "hasta" | "modo">, fecha?: string | null, paises: PaisesTraslado = {}): EnlaceTransporte[] {
  const { desde, hasta, modo } = traslado;
  if (modo === "coche") return [];
  const dia = fecha && FECHA_ISO.test(fecha) ? fecha : null;
  const tramo = `${desde} → ${hasta}`;

  if (modo === "avion") {
    const q = `Flights to ${hasta} from ${desde}${dia ? ` on ${dia}` : ""}`;
    return [{ etiqueta: `Buscar vuelos ${tramo}`, nombreAccesible: `Buscar vuelos ${tramo}`, href: urlGoogle("/travel/flights", { q }) }];
  }

  const medio = modo === "tren" ? "tren" : "autobús";
  const q = `${medio} ${desde} ${hasta}${dia ? ` ${dia}` : ""}`;
  return [
    { etiqueta: `Buscar ${medio} ${tramo}`, nombreAccesible: `Buscar ${medio} ${tramo}`, href: urlGoogle("/search", { q }) },
    {
      etiqueta: "Ver en Google Maps en transporte público",
      nombreAccesible: `Ver en Google Maps en transporte público: ${tramo}`,
      // Google Maps URLs no admite fecha ni hora de salida.
      href: urlGoogle("/maps/dir/", { api: "1", origin: conPais(desde, paises.origen), destination: conPais(hasta, paises.destino), travelmode: "transit" }),
    },
  ];
}
