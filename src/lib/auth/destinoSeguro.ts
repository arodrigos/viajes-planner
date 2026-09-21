// Hermana conceptual de allowlist.ts: aquella es la lista blanca de quién
// puede entrar, esta es la lista blanca de a dónde puede llevarle un enlace
// mágico. Sacada a función pura para poder probar la tabla completa de
// codificaciones hostiles con vitest, sin gastar un enlace mágico real por
// caso (Supabase limita los envíos de correo por dirección).
export const DESTINO_POR_DEFECTO = "/criterios";

// Nunca se sanea `next` para intentar reutilizarlo: se valida contra lo
// permitido (ruta relativa que resuelve al MISMO origen) y, si no lo es, se
// cae en silencio al destino por defecto -- no hay que enseñarle al
// atacante que su parámetro se ha rechazado. `resuelto.origin === origen`
// es la comprobación que importa: una comparación de cadenas se dejaría
// engañar por barras invertidas o codificaciones que el propio parser de
// URL normaliza de otra forma.
//
// Devuelve el objeto `URL` YA RESUELTO, no una cadena. Antes se devolvía
// `pathname+search+hash` para que la ruta la volviera a resolver con
// `new URL(destino, origen)`: con un `next` como `/..//sitio-ajeno.example`
// la PRIMERA resolución normaliza el `..` y da un origen correcto, pero el
// `pathname` que queda (`//sitio-ajeno.example`) es protocol-relative, y esa
// SEGUNDA resolución lo reinterpreta como otro host -- el mismo valor ya
// validado deja de estarlo al pasar otra vez por `new URL()`. Devolver el
// objeto ya resuelto y que quien llama use su `.href` directamente (sin
// volver a parsearlo) elimina la clase entera de fallo, no solo el caso
// concreto que la encontró.
export function destinoSeguro(next: string | null | undefined, origen: string): URL {
  const porDefecto = new URL(DESTINO_POR_DEFECTO, origen);
  if (!next) return porDefecto;

  let resuelto: URL;
  try {
    resuelto = new URL(next, origen);
  } catch {
    return porDefecto;
  }

  if (resuelto.origin !== origen) return porDefecto;

  return resuelto;
}
