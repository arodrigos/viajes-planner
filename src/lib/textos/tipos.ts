// Cada texto declara su tipo para que el test del catálogo le aplique la
// regla que toca: un botón empieza por verbo, una ayuda es corta.
export type TipoTexto = "boton" | "enlace" | "titulo" | "ayuda" | "error" | "vacio" | "estado";

export interface Texto {
  tipo: TipoTexto;
  texto: string;
}

export const t = (tipo: TipoTexto, texto: string): Texto => ({ tipo, texto });
