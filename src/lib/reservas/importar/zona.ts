// Una zona que Intl no conozca lanza RangeError: es la misma prueba que usa
// validarReserva para zona_inicio y zona_fin.
export function esZonaIana(zona: string): boolean {
  if (zona === "" || zona.length > 64) return false;
  try {
    new Intl.DateTimeFormat("es", { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

// Fecha y hora de pared que tiene un instante en una zona.
export function aLocal(instanteMs: number, zona: string): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: zona, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(instanteMs));
  const g = (t: string) => partes.find((p) => p.type === t)?.value ?? "00";
  return { fecha: `${g("year")}-${g("month")}-${g("day")}`, hora: `${g("hour")}:${g("minute")}` };
}

// Centro de la caja de la ciudad del plan, para deducir su zona horaria.
export function centroDeCaja(caja?: { minLat: number; maxLat: number; minLon: number; maxLon: number }): { lat: number; lon: number } | null {
  return caja ? { lat: (caja.minLat + caja.maxLat) / 2, lon: (caja.minLon + caja.maxLon) / 2 } : null;
}
