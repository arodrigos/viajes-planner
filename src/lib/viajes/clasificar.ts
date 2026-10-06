// Fecha local del dispositivo como AAAA-MM-DD. Se compara como texto ISO, que
// ordena igual que las fechas, sin pasar por Date.parse y sus zonas horarias.
export function hoyLocalISO(ahora: Date): string {
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

// Un viaje es pasado solo si su último día ya quedó atrás. Uno en curso (acaba
// hoy o mañana) y uno sin fechas exactas (solo época) siguen en «Próximos»:
// esconderlos como pasados sería perder de vista un viaje vivo.
export function esViajePasado(fechaFin: string | null, hoyISO: string): boolean {
  if (!fechaFin) return false;
  return fechaFin < hoyISO;
}
