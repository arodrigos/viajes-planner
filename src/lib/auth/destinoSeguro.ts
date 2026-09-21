// Hermana conceptual de allowlist.ts: aquella es la lista blanca de quién
// puede entrar, esta es la lista blanca de a dónde puede llevarle un enlace
// mágico. Sacada a función pura para poder probar la tabla completa de
// codificaciones hostiles con vitest, sin gastar un enlace mágico real por
// caso (Supabase limita los envíos de correo por dirección).
export const DESTINO_POR_DEFECTO = "/criterios";

// Nunca se sanea `next` para intentar reutilizarlo: se valida contra lo
// permitido (ruta relativa que resuelve al MISMO origen) y, si no lo es, se
// cae en silencio al destino por defecto -- no hay que enseñarle al
// atacante que su parámetro se ha rechazado. `new URL(next, origen).origin`
// es la comprobación que importa: una comparación de cadenas se dejaría
// engañar por barras invertidas o codificaciones que el propio parser de
// URL normaliza de otra forma.
export function destinoSeguro(next: string | null | undefined, origen: string): string {
  if (!next) return DESTINO_POR_DEFECTO;

  let resuelto: URL;
  try {
    resuelto = new URL(next, origen);
  } catch {
    return DESTINO_POR_DEFECTO;
  }

  if (resuelto.origin !== origen) return DESTINO_POR_DEFECTO;

  return `${resuelto.pathname}${resuelto.search}${resuelto.hash}`;
}
