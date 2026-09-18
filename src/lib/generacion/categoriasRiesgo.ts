// generacion-ac2: categorías de riesgo físico excluidas SIEMPRE, aunque los
// criterios del usuario las pidan explícitamente. La detección es por
// palabra clave sobre nombre+descripcion: en fase 1 la parada no tiene
// campo de categoría estructurado (ver src/lib/plan/tipos.ts), así que esto
// es la única red de seguridad que no depende de que el modelo obedezca al
// prompt.
export interface CategoriaRiesgo {
  id: string;
  etiqueta: string;
  patron: RegExp;
}

export const CATEGORIAS_RIESGO: CategoriaRiesgo[] = [
  { id: "montana", etiqueta: "montaña", patron: /monta[ñn]a|alta monta[ñn]a|alpin/i },
  {
    id: "senderismo-de-altura",
    etiqueta: "senderismo de altura",
    patron: /senderismo de altura|trekking de altura|via ferrata|ascensi[oó]n a la cumbre/i,
  },
  {
    id: "actividades-acuaticas",
    etiqueta: "actividades acuáticas",
    patron: /barranquismo|rafting|buceo|submarinismo|surf|kayak|pirag[uü]ismo/i,
  },
  {
    id: "exposicion-estacional",
    etiqueta: "entornos con exposición estacional",
    patron: /avalancha|glaciar|desierto extremo|ola de calor|tormenta tropical/i,
  },
];

export function detectarCategoriaRiesgo(parada: { nombre: string; descripcion: string }): CategoriaRiesgo | null {
  const texto = `${parada.nombre} ${parada.descripcion}`;
  return CATEGORIAS_RIESGO.find((categoria) => categoria.patron.test(texto)) ?? null;
}
