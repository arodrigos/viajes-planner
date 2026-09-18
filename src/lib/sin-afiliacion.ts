// Regla de encuadre (manifiesto: uso personal y familiar, sin monetización):
// ninguna URL de salida lleva parámetros de afiliación y no se sirve ningún
// script de red publicitaria. Es la única condición de la que dependen a la
// vez Vercel Hobby, MapTiler Free y la reutilización del contenido con
// licencia compartir igual, así que se comprueba en cada push desde este
// bloque y sobre el HTML ya renderizado, no solo sobre el código fuente.
const PARAMETROS_AFILIACION = /[?&](tag|aid|ref|affiliate|partner_?id)=/i;

const DOMINIOS_PUBLICIDAD = [
  "googlesyndication.com",
  "doubleclick.net",
  "adsystem.amazon",
  "taboola.com",
  "outbrain.com",
];

export function contieneParametrosAfiliacion(url: string): boolean {
  return PARAMETROS_AFILIACION.test(url);
}

export function contieneScriptPublicitario(html: string): boolean {
  return DOMINIOS_PUBLICIDAD.some((dominio) => html.includes(dominio));
}

export function extraerUrls(html: string): string[] {
  const coincidencias = html.matchAll(/(?:href|src)="([^"]+)"/g);
  return Array.from(coincidencias, (m) => m[1]);
}

export function auditarHtml(html: string): { ok: boolean; motivos: string[] } {
  const motivos: string[] = [];
  const urlsSospechosas = extraerUrls(html).filter(contieneParametrosAfiliacion);
  if (urlsSospechosas.length > 0) {
    motivos.push(`URLs con parámetro de afiliación: ${urlsSospechosas.join(", ")}`);
  }
  if (contieneScriptPublicitario(html)) {
    motivos.push("dominio de red publicitaria presente en el HTML");
  }
  return { ok: motivos.length === 0, motivos };
}
