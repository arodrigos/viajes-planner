// Único sitio donde se formatean números para la interfaz y la lámina: así la
// web y el PNG nunca discrepan en cómo escriben un importe. Fuera de este
// directorio no se usa toLocaleString ni Intl.NumberFormat.

// useGrouping 'always' porque es-ES, por defecto, no separa las cifras de
// cuatro dígitos («3000») y dentro de una misma lista acabaría mezclando
// «3000 €» con «12.345 €» (punto de miles siempre).
const NUMERO = new Intl.NumberFormat("es-ES", { useGrouping: "always", maximumFractionDigits: 0 });
const KM = new Intl.NumberFormat("es-ES", { useGrouping: "always", minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Espacio duro: evita que «€» quede sola al principio de una línea en 390 px.
const NBSP = " ";

export function formatearNumero(n: number): string {
  return NUMERO.format(Math.round(n));
}

export function formatearEuros(importe: number): string {
  return `${formatearNumero(importe)}${NBSP}€`;
}

// Gastos reales: con céntimos y coma decimal («1.174,50 €»), porque se apuntan
// al céntimo. Entra en céntimos enteros para no pasar por coma flotante.
const EUROS_CENTIMOS = new Intl.NumberFormat("es-ES", { useGrouping: "always", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatearEurosCentimos(centimos: number): string {
  const signo = centimos < 0 ? "-" : "";
  const abs = Math.abs(centimos);
  return `${signo}${EUROS_CENTIMOS.format(Math.floor(abs / 100) + (abs % 100) / 100)}${NBSP}€`;
}

export function formatearKm(km: number): string {
  return `${KM.format(km)} km`;
}

export function formatearMinutos(minutos: number): string {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

// Los años nunca llevan separador de miles (RAE y FundéuRAE).
export function formatearAnio(anio: number): string {
  return String(anio);
}
