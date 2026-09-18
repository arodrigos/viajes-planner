import type { CriteriosViaje, Perfil } from "@/lib/criterios/tipos";

// El único parámetro numérico del sistema (ver descripción del bloque
// generacion): por defecto lo deriva el perfil, porque no existe señal de
// datos abiertos que signifique "apto para familias" (kids_area aparece en
// 4.443 objetos en todo el mundo). El usuario puede sobrescribirlo con
// tope_sitios_por_franja.
const TOPE_POR_PERFIL: Record<Perfil, number> = {
  familiar: 2,
  pareja: 3,
  amigos: 4,
  solo: 4,
};

export function topeEfectivo(criterios: CriteriosViaje): number {
  return criterios.tope_sitios_por_franja ?? TOPE_POR_PERFIL[criterios.perfil];
}
