// alc-ac5: única puerta de las URLs de foto. Una foto solo se guarda y se
// pinta si apunta al CDN de Wikimedia por https: cualquier otra cosa
// (http://, otro host, javascript:, data:) saldría de una fuente externa o
// de un dato manipulado y acabaría en un atributo `src`.
import type { Foto } from "@/lib/plan/tipos";

const PREFIJO = "https://upload.wikimedia.org/";
const HOST = "upload.wikimedia.org";

export function esUrlFotoValida(url: unknown): boolean {
  if (typeof url !== "string" || !url.startsWith(PREFIJO)) return false;
  try {
    const analizada = new URL(url);
    return analizada.protocol === "https:" && analizada.hostname === HOST && analizada.username === "" && analizada.password === "";
  } catch {
    return false;
  }
}

// La API de Commons devuelve hoy las miniaturas en thumb.wikimedia.org; la
// misma ruta se sirve desde upload.wikimedia.org, el único host que se
// acepta, así que se reescribe el host en vez de perder todas las fotos.
export function normalizarUrlFoto(url: string): string {
  const host = "https://thumb.wikimedia.org/";
  return url.startsWith(host) ? PREFIJO + url.slice(host.length) : url;
}

// Hallazgo de seguridad #97: `licencia_url` sale de extmetadata.LicenseUrl,
// un campo editable de un wiki, y acaba en un `href`. Solo se acepta https
// sin credenciales; cualquier otra cosa se cambia por la página de licencias
// de Commons, que siempre es un enlace correcto aunque menos preciso.
export const LICENCIAS_COMMONS = "https://commons.wikimedia.org/wiki/Commons:Licensing";

export function licenciaUrlSegura(url: unknown): string {
  if (typeof url !== "string") return LICENCIAS_COMMONS;
  const absoluta = url.startsWith("//") ? `https:${url}` : url;
  try {
    const analizada = new URL(absoluta);
    return analizada.protocol === "https:" && analizada.username === "" && analizada.password === "" ? absoluta : LICENCIAS_COMMONS;
  } catch {
    return LICENCIAS_COMMONS;
  }
}

export function fotoSegura<T extends Pick<Foto, "url">>(foto: T | null | undefined): T | undefined {
  if (!foto || !esUrlFotoValida(foto.url)) return undefined;
  // Fotos ya guardadas antes de #97: se sanea al leer, no hace falta migrar.
  if ("licencia_url" in foto) return { ...foto, licencia_url: licenciaUrlSegura((foto as { licencia_url?: unknown }).licencia_url) };
  return foto;
}
