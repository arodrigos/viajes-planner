import { TEXTOS_AHORA } from "./ahora";
import { TEXTOS_PORTADA } from "./portada";
import { TEXTOS_VIAJES } from "./viajes";

// Todo catálogo nuevo se añade aquí: el test recorre este objeto, así que un
// texto fuera de él escapa a las reglas de docs/guia-de-estilo.md.
export const CATALOGO = { ahora: TEXTOS_AHORA, portada: TEXTOS_PORTADA, viajes: TEXTOS_VIAJES } as const;
