import type { CategoriaPreparativo, ElementoPreparativo, EntradaPreparativos } from "./tipos";
import { ENCHUFES_POR_PAIS } from "./enchufes";

interface EntradaCatalogo {
  id: string;
  categoria: CategoriaPreparativo;
  texto: (e: EntradaPreparativos) => string;
  // null = no aplica; si aplica, devuelve el porqué que se enseña.
  regla: (e: EntradaPreparativos) => string | null;
  fuente?: ElementoPreparativo["fuente"];
}


export type Estacion = "verano" | "invierno" | "entretiempo" | null;

// Con fechas exactas y latitud conocida; en el hemisferio sur se invierte.
// Sin alguna de las dos no se adivina.
export function estacionDe(e: EntradaPreparativos): Estacion {
  if (e.fechas.modo !== "fechas" || e.latitud === null) return null;
  const mes = Number(e.fechas.inicio.slice(5, 7));
  if (!(mes >= 1 && mes <= 12)) return null;
  const norte = e.latitud >= 0 ? mes : ((mes + 5) % 12) + 1;
  if (norte >= 6 && norte <= 9) return "verano";
  if (norte === 12 || norte <= 2) return "invierno";
  return "entretiempo";
}

const edades = (e: EntradaPreparativos, f: (n: number) => boolean) => e.personas.map((p) => p.edad).filter(f);
const anios = (xs: number[]) => xs.map((n) => (n === 1 ? "1 año" : n === 0 ? "menos de 1 año" : `${n} años`)).join(", ");
const hayBebe = (e: EntradaPreparativos) => edades(e, (n) => n < 3);
const hayNino = (e: EntradaPreparativos) => edades(e, (n) => n >= 3 && n <= 12);
const hayMenor = (e: EntradaPreparativos) => edades(e, (n) => n < 18);
const bebePorque = (e: EntradaPreparativos) => {
  const b = hayBebe(e);
  return b.length ? `Viaja ${b.length === 1 ? "un bebé" : "más de un bebé"} de ${anios(b)}.` : null;
};
const hayVuelo = (e: EntradaPreparativos) => e.transporte.includes("avion") || e.tiposReserva.includes("vuelo");
const PORQUE_VUELO = (e: EntradaPreparativos) =>
  e.tiposReserva.includes("vuelo") ? "Porque tienes un vuelo apuntado en Reservas." : "Porque el viaje incluye un vuelo.";
const tiposEnchufe = (e: EntradaPreparativos) => (e.pais ? ENCHUFES_POR_PAIS[e.pais] : undefined);
const estacionDeLista = (e: EntradaPreparativos, quiere: Estacion, porque: string) => (estacionDe(e) === quiere ? porque : null);

const FUENTE_DOCS = {
  titulo: "Policía Nacional: documentación para viajar",
  url: "https://sede.policia.gob.es/portalCiudadano/_es/tramites_ciudadania_documentacionviajar.php",
  revisado: "2026-11-12",
};
const FUENTE_CDC = {
  titulo: "CDC Yellow Book: botiquín de viaje",
  url: "https://www.cdc.gov/yellow-book/hcp/preparing-international-travelers/travel-health-kits.html",
  revisado: "2026-11-12",
};

// El orden del catálogo es el orden de la lista. Nunca hay un permiso de viaje
// como elemento: Viajes no sabe si un menor viaja sin sus padres.
export const CATALOGO_PREPARATIVOS: readonly EntradaCatalogo[] = [
  { id: "documentos-menores", categoria: "documentos", fuente: FUENTE_DOCS,
    texto: () => "DNI o pasaporte en vigor de cada niño",
    regla: (e) => hayMenor(e).length ? `Viajan menores (${anios(hayMenor(e))}); cada uno necesita su documento; si alguno viajara sin sus padres, mira antes si hace falta autorización.` : null },
  { id: "tarjetas-embarque", categoria: "documentos", texto: () => "Tarjetas de embarque",
    regla: (e) => (hayVuelo(e) ? PORQUE_VUELO(e) : null) },
  { id: "copia-documentos", categoria: "documentos", texto: () => "Copia de los documentos (foto o papel)", regla: () => "Por si se pierde o te roban el original." },
  { id: "confirmar-alojamiento", categoria: "antes-de-salir", texto: () => "Confirmar el alojamiento",
    regla: (e) => (e.dias > 1 && !e.tiposReserva.includes("hotel") ? "Porque no has apuntado ningún hotel en Reservas." : null) },
  { id: "descargar-mapas", categoria: "antes-de-salir", texto: () => "Descargar los mapas del viaje para usarlos sin datos", regla: () => "Para orientarte sin cobertura." },
  { id: "vaciar-nevera", categoria: "antes-de-salir", texto: () => "Vaciar la nevera", regla: () => "Para no volver a comida estropeada." },
  { id: "panales", categoria: "ninos", texto: () => "Pañales", regla: bebePorque },
  { id: "toallitas", categoria: "ninos", texto: () => "Toallitas", regla: bebePorque },
  { id: "cambiador", categoria: "ninos", texto: () => "Cambiador portátil", regla: bebePorque },
  { id: "carrito-o-mochila", categoria: "ninos", texto: () => "Carrito o mochila portabebés", regla: bebePorque },
  { id: "entretenimiento-trayecto", categoria: "ninos", texto: () => "Entretenimiento para el trayecto",
    regla: (e) => (hayNino(e).length ? `Viaja un niño de ${anios(hayNino(e))} y el trayecto se hace largo.` : null) },
  { id: "muda-extra", categoria: "ninos", texto: () => "Muda extra en la mochila de mano",
    regla: (e) => (hayNino(e).length ? `Viaja un niño de ${anios(hayNino(e))}.` : null) },
  { id: "silla-coche", categoria: "ninos", texto: () => "Silla de coche",
    regla: (e) => (e.transporte.includes("coche") && edades(e, (n) => n <= 12).length ? "Porque viajas en coche con niños." : null) },
  { id: "liquidos-cabina", categoria: "antes-de-salir", texto: () => "Líquidos en bolsa transparente (máx. 100 ml) para cabina",
    regla: (e) => (hayVuelo(e) ? PORQUE_VUELO(e) : null) },
  { id: "botiquin", categoria: "salud", fuente: FUENTE_CDC, texto: () => "Botiquín básico", regla: () => "Para un viaje de varios días." },
  { id: "dosificador-infantil", categoria: "salud", fuente: FUENTE_CDC, texto: () => "Dosificador para medicamentos infantiles",
    regla: (e) => (hayMenor(e).length ? `Viajan menores (${anios(hayMenor(e))}).` : null) },
  { id: "protector-solar", categoria: "ropa", texto: () => "Protector solar", regla: (e) => estacionDeLista(e, "verano", "Porque viajas en verano en el destino.") },
  { id: "gorra", categoria: "ropa", texto: () => "Gorra o sombrero", regla: (e) => estacionDeLista(e, "verano", "Porque viajas en verano en el destino.") },
  { id: "abrigo", categoria: "ropa", texto: () => "Abrigo", regla: (e) => estacionDeLista(e, "invierno", "Porque viajas en invierno en el destino.") },
  { id: "guantes", categoria: "ropa", texto: () => "Guantes y gorro", regla: (e) => estacionDeLista(e, "invierno", "Porque viajas en invierno en el destino.") },
  { id: "chubasquero", categoria: "ropa", texto: () => "Chubasquero ligero", regla: (e) => estacionDeLista(e, "entretiempo", "Porque viajas en entretiempo, cuando llueve más.") },
  { id: "ropa-tiempo-destino", categoria: "ropa", texto: () => "Mirar el tiempo del destino antes de hacer la maleta",
    regla: (e) => (estacionDe(e) === null ? "Porque no sabemos la estación exacta de tu viaje." : null) },
  { id: "cargadores", categoria: "electronica", texto: () => "Cargadores del móvil y otros aparatos", regla: () => "Para no quedarte sin batería." },
  { id: "adaptador-enchufe", categoria: "electronica",
    texto: (e) => `Adaptador de enchufe (tipo ${(tiposEnchufe(e) ?? []).join(" o ")})`,
    regla: (e) => { const t = tiposEnchufe(e); return t && !t.includes("C") && !t.includes("F") ? `Porque en ${e.pais} usan enchufe tipo ${t.join(" o ")}.` : null; } },
  { id: "comprobar-enchufe", categoria: "electronica", texto: () => "Comprobar el tipo de enchufe del destino",
    regla: (e) => (tiposEnchufe(e) ? null : "Porque no sabemos el país del destino.") },
];

export const IDS_PREPARATIVOS: ReadonlySet<string> = new Set(CATALOGO_PREPARATIVOS.map((c) => c.id));
