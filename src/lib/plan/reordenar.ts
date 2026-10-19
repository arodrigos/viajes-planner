// Funciones puras del orden de un día, compartidas por la ruta (servidor) y
// por el hook del cliente: así lo que el navegador muestra al pulsar y lo que
// el servidor acepta se calculan con la misma regla. Sin imports de
// server-only.

export interface EntradaOrden {
  // id_externo de la parada.
  id: string;
  franja_id: string;
}

export interface PeticionOrden {
  version_base: number;
  dia_index: number;
  orden: EntradaOrden[];
}

function indiceFranja(franjas: readonly { id: string }[], franjaId: string): number {
  return franjas.findIndex((f) => f.id === franjaId);
}

// Mover a mano puede cambiar de franja (decisión de Adrián, opción A): una
// parada que es la primera de su franja y sube toma la franja de la parada
// que tenía encima (la última visible), no la inmediata anterior, que en los
// planes reales suele estar vacía y pintaría un encabezado nuevo. Lo mismo al
// bajar. En el extremo del día no hay vecino del que copiar la franja y la
// parada no se mueve: saltar a una franja vacía pintaría un encabezado nuevo
// y rompería el límite de Subir/Bajar desactivados en la primera y la última.
export function moverParada(orden: readonly EntradaOrden[], id: string, direccion: "arriba" | "abajo"): EntradaOrden[] {
  const i = orden.findIndex((e) => e.id === id);
  const copia = orden.map((e) => ({ ...e }));
  if (i < 0) return copia;
  const vecino = direccion === "arriba" ? i - 1 : i + 1;
  if (vecino < 0 || vecino >= orden.length) return copia;

  if (orden[vecino].franja_id === orden[i].franja_id) {
    [copia[i], copia[vecino]] = [copia[vecino], copia[i]];
  } else {
    copia[i] = { id: orden[i].id, franja_id: orden[vecino].franja_id };
  }
  return copia;
}

// Los botones Subir/Bajar se activan solo si pulsarlos cambia algo.
export function puedeMoverParada(orden: readonly EntradaOrden[], id: string, direccion: "arriba" | "abajo"): boolean {
  return !mismoOrden(orden, moverParada(orden, id, direccion));
}

export type ResultadoValidacion = { ok: true } | { ok: false; motivo: string };

// Misma comprobación que hace reordenar_dia_plan en la base: permutación
// exacta de las paradas del día, franjas del día y secuencia de franjas que
// no retrocede.
export function validarOrden(
  base: readonly EntradaOrden[],
  nuevo: readonly EntradaOrden[],
  franjas: readonly { id: string }[],
): ResultadoValidacion {
  if (nuevo.length !== base.length) return { ok: false, motivo: "no es una permutación del día" };
  const idsBase = new Set(base.map((e) => e.id));
  const vistos = new Set<string>();
  let previo = -1;
  for (const entrada of nuevo) {
    if (!idsBase.has(entrada.id)) return { ok: false, motivo: "hay una parada que no es del día" };
    if (vistos.has(entrada.id)) return { ok: false, motivo: "hay una parada repetida" };
    vistos.add(entrada.id);
    const indice = indiceFranja(franjas, entrada.franja_id);
    if (indice < 0) return { ok: false, motivo: "hay una franja que no es del día" };
    if (indice < previo) return { ok: false, motivo: "las franjas no pueden retroceder" };
    previo = indice;
  }
  return { ok: true };
}

// Aplica un orden a una lista de paradas del día: devuelve las mismas paradas
// en el orden pedido y con la franja pedida. Lo que no está en el orden no se
// inventa: se descarta (validarOrden ya ha comprobado la permutación).
export function aplicarOrden<T extends { id: string; franja_id: string }>(paradas: readonly T[], orden: readonly EntradaOrden[]): T[] {
  const porId = new Map(paradas.map((p) => [p.id, p]));
  const salida: T[] = [];
  for (const entrada of orden) {
    const parada = porId.get(entrada.id);
    if (parada) salida.push({ ...parada, franja_id: entrada.franja_id });
  }
  return salida;
}

export function ordenDeParadas(paradas: readonly { id: string; franja_id: string }[]): EntradaOrden[] {
  return paradas.map((p) => ({ id: p.id, franja_id: p.franja_id }));
}

export function mismoOrden(a: readonly EntradaOrden[], b: readonly EntradaOrden[]): boolean {
  return a.length === b.length && a.every((e, i) => e.id === b[i].id && e.franja_id === b[i].franja_id);
}

// El arrastre trabaja con una lista de ids por franja; el servidor, con una
// lista plana. Aplanar siguiendo el orden de las franjas del día es lo que
// garantiza que la secuencia de franjas nunca decrezca, venga el grupo de
// donde venga.
export function agruparPorFranja(orden: readonly EntradaOrden[], franjas: readonly { id: string }[]): Record<string, string[]> {
  const grupos: Record<string, string[]> = Object.fromEntries(franjas.map((f) => [f.id, []]));
  for (const entrada of orden) grupos[entrada.franja_id]?.push(entrada.id);
  return grupos;
}

export function ordenDesdeGrupos(grupos: Readonly<Record<string, readonly string[]>>, franjas: readonly { id: string }[]): EntradaOrden[] {
  return franjas.flatMap((franja) => (grupos[franja.id] ?? []).map((id) => ({ id, franja_id: franja.id })));
}
