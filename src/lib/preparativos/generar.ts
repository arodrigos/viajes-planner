import { CATALOGO_PREPARATIVOS } from "./catalogo";
import type { ElementoPreparativo, EntradaPreparativos } from "./tipos";

// Pura y determinista: mismo input, misma lista y mismo orden (el del catálogo).
export function generarPreparativos(entrada: EntradaPreparativos): ElementoPreparativo[] {
  const lista: ElementoPreparativo[] = [];
  for (const c of CATALOGO_PREPARATIVOS) {
    const porque = c.regla(entrada);
    if (porque === null) continue;
    lista.push({ id: c.id, categoria: c.categoria, texto: c.texto(entrada), porque, ...(c.fuente ? { fuente: c.fuente } : {}) });
  }
  return lista;
}
