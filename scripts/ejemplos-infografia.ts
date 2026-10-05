// Planes inventados que comparten el generador de ejemplos y el medidor: lo que
// se mira a ojo y lo que se mide es lo mismo.
import { franjasComoArray } from "../src/lib/plan/config-franjas";
import type { Parada, Plan } from "../src/lib/plan/tipos";

export const parada = (id: string, nombre: string, prioridad: number, importe: number): Parada => ({
  id, franja_id: "manana", nombre, descripcion: "Visita", duracion_min: 90, prioridad, procedencia: { fuente: "propuesto-sin-verificar" },
  coste: { importe_eur: importe, por: "persona", procedencia: "estimado", fecha: "2027-06-08" },
});

export const franjas = franjasComoArray("Portugal");
export const ciudad = (nombre: string, lat: number, lon: number) => ({
  estado: "resuelta" as const, nombre, metodo: "destino" as const, caja: { minLat: lat - 0.1, maxLat: lat + 0.1, minLon: lon - 0.1, maxLon: lon + 0.1 }, intentado_en: "2027-01-01T00:00:00Z",
});
export const etapa = (nombre: string, lat: number, lon: number, dia_inicio: number, noche: number) => ({
  ciudad: ciudad(nombre, lat, lon), pais: "Portugal", dias: 3, dia_inicio, alojamiento_noche_eur: noche, zona: 0, ajustes: [],
});

export const multiciudad: Plan = {
  id: "ejemplo-multi", version: 1, destino: "Portugal", personas: 2,
  dias: Array.from({ length: 9 }, (_, i) => ({
    fecha: `2027-06-${String(8 + i).padStart(2, "0")}`, franjas, etapa: Math.floor(i / 3),
    paradas: [parada(`a${i}`, ["Torre de Belém", "Alfama", "Sintra", "Ribeira", "Livraria Lello", "Palacio da Bolsa", "Universidad de Coímbra", "Biblioteca Joanina", "Mosteiro"][i], 90 - i, 15), parada(`b${i}`, `Paseo ${i + 1}`, 40, 0)],
  })),
  etapas: [etapa("Lisboa", 38.72, -9.14, 0, 90), etapa("Coímbra", 40.2, -8.42, 3, 70), etapa("Oporto", 41.15, -8.61, 6, 80)],
  traslados: [
    { desde: "Lisboa", hasta: "Coímbra", modo: "tren", distancia_km: 200, duracion_min: 110, coste_eur: 25, procedencia: "estimado" },
    { desde: "Coímbra", hasta: "Oporto", modo: "tren", distancia_km: 120, duracion_min: 90, coste_eur: 20, procedencia: "estimado" },
  ],
  eventos: { estado: "consultado", consultado_en: "2027-01-01T00:00:00Z", eventos: [{ fecha: "2027-06-10", nombre: "Día de Portugal", tipo: "festivo", fuente: "nager", url: "https://date.nager.at", etapa: 0, pais: "PT" }, { fecha: "2027-06-13", nombre: "Fiesta de San Antonio", tipo: "fiesta", fuente: "wikidata", url: "https://www.wikidata.org", etapa: 0, pais: "PT" }] },
};

export const unaCiudad: Plan = {
  id: "ejemplo-una", version: 1, destino: "Toledo", personas: 3,
  dias: Array.from({ length: 3 }, (_, i) => ({
    fecha: `2027-03-${String(5 + i).padStart(2, "0")}`, franjas,
    paradas: [parada(`t${i}a`, ["Catedral de Toledo", "Sinagoga del Tránsito", "Alcázar"][i], 90, 12), parada(`t${i}b`, ["Mirador del Valle", "Puente de San Martín", "Mercado"][i], 60, 0)],
  })),
};

// Caso peor de una ciudad: título largo con espacios de más, más días de los que
// caben, nombres de parada largos y cuatro eventos.
export const unaCiudadLarga: Plan = {
  id: "ejemplo-larga", version: 1, destino: "Escapada  de  otoño por la Ribeira Sacra con abuelos, primos y perro", personas: 6,
  dias: Array.from({ length: 10 }, (_, i) => ({
    fecha: `2027-03-${String(5 + i).padStart(2, "0")}`, franjas,
    paradas: [parada(`l${i}a`, "Monasterio de Santo Estevo de Ribas de Sil y paseo por los cañones del río", 90, 12), parada(`l${i}b`, `Catamarán por el Sil, tramo ${i + 1}`, 60, 20)],
  })),
  eventos: { estado: "consultado", consultado_en: "2027-01-01T00:00:00Z", eventos: ["Fiesta de la vendimia de Ribeira Sacra con degustación de vinos", "Mercado medieval", "Romería de San Roque", "Festival de música tradicional del Sil"].map((nombre, i) => ({ fecha: `2027-03-${String(6 + i).padStart(2, "0")}`, nombre, tipo: "fiesta" as const, fuente: "wikidata" as const, url: "https://www.wikidata.org", etapa: 0, pais: "ES" })) },
};
