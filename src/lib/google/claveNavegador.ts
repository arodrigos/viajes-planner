// Único sitio que lee la clave de navegador. Next solo sustituye la variable
// al compilar si se accede por su nombre literal, así que no se parametriza.
// Una cadena vacía cuenta como ausente: es lo que deja Vercel al borrarla.
export function claveNavegador(): string | null {
  const valor = process.env.NEXT_PUBLIC_GOOGLE_MAPS_CLAVE_NAVEGADOR?.trim();
  return valor ? valor : null;
}
