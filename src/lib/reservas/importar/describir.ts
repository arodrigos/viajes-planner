import type { Momento } from "./tipos";

// atajo: solo las ciudades europeas y de viaje más comunes tienen nombre en
// castellano; el resto se lee tal cual la zona IANA. Ampliar si en el uso real
// salen nombres en inglés.
const EN_CASTELLANO: Record<string, string> = {
  Rome: "Roma",
  Lisbon: "Lisboa",
  London: "Londres",
  Paris: "París",
  Brussels: "Bruselas",
  Vienna: "Viena",
  Prague: "Praga",
  Athens: "Atenas",
  Warsaw: "Varsovia",
  Copenhagen: "Copenhague",
  Zurich: "Zúrich",
  Moscow: "Moscú",
  Cairo: "El Cairo",
  New_York: "Nueva York",
  Mexico_City: "Ciudad de México",
  Seville: "Sevilla",
};

export function ciudadDeZona(zona: string): string {
  const ultimo = zona.split("/").pop() ?? zona;
  return EN_CASTELLANO[ultimo] ?? ultimo.replaceAll("_", " ");
}

// «sáb 3 jul 2027»: se formatea en UTC porque la fecha ya es de pared, sin
// zona que la desplace.
export function diaCorto(fecha: string): string {
  const partes = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(new Date(`${fecha}T00:00:00Z`));
  const g = (t: string) => (partes.find((p) => p.type === t)?.value ?? "").replace(/\.$/, "");
  return `${g("weekday")} ${g("day")} ${g("month")} ${g("year")}`;
}

export function etiquetaMomento(m: Momento): string {
  const piezas = [];
  if (m.hora) piezas.push(m.hora);
  piezas.push(diaCorto(m.fecha));
  if (m.zona) piezas.push(`hora de ${ciudadDeZona(m.zona)}`);
  return piezas.join(" · ");
}
