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

export function fotoSegura<T extends Pick<Foto, "url">>(foto: T | null | undefined): T | undefined {
  return foto && esUrlFotoValida(foto.url) ? foto : undefined;
}
