// etapas-pais (eta-ac1): validación y reparación deterministas de las etapas
// que propone el modelo. Puro: las ciudades ya vienen geocodificadas (punto y
// zona) para que ninguna regla hable con la red.
import type { Modo } from "@/lib/criterios/tipos";
import { normalizarNombre } from "@/lib/lugares/normalizar";
import type { Dia } from "@/lib/plan/tipos";
import type { Zona } from "./clasificar";
import { TOPE_AVION_MIN, TOPE_TIERRA_MIN } from "./constantes";
import { maxEtapas } from "./reglas";
import { estimarTraslado, type Punto, type Traslado } from "./traslados";
import type { Razon } from "./viabilidad";

export interface EtapaPropuesta {
  ciudad: string;
  pais: string;
  dias: number;
  motivo?: string;
  alojamiento_noche_eur: number;
}

// Una etapa ya situada: `punto` es null si la ciudad no geocodificó y `zona`
// el índice de la zona pedida que contiene ese punto (null si cae fuera).
export interface EtapaGeo extends EtapaPropuesta {
  punto: Punto | null;
  zona: number | null;
  ajustes: string[];
}

export interface ContextoEtapas {
  zonas: readonly Zona[];
  modos: readonly Modo[];
  personas: number;
  diasTotales: number;
  presupuestoEur: number;
  // Suma de las visitas del plan (coste_eur_persona × personas).
  actividadesEur: number;
}

export interface ErrorEtapa {
  codigo: Razon["codigo"];
  texto: string;
}

const MIN_DIAS_ETAPA = 2;
const VIAJE_CORTO_DIAS = 3;

const euros = (n: number): string => `${Math.round(n).toLocaleString("es-ES")} €`;

export function asignarZona(punto: Punto, zonas: readonly Zona[]): number | null {
  const i = zonas.findIndex((z) => punto.lat >= z.caja.minLat && punto.lat <= z.caja.maxLat && punto.lon >= z.caja.minLon && punto.lon <= z.caja.maxLon);
  return i === -1 ? null : i;
}

// Trayecto entre etapas consecutivas con los medios permitidos; null donde
// ningún medio cabe en su tope (o falta un punto).
export function trasladosDe(etapas: readonly EtapaGeo[], modos: readonly Modo[], personas: number): (Traslado | null)[] {
  const tramos: (Traslado | null)[] = [];
  for (let i = 0; i + 1 < etapas.length; i++) {
    const a = etapas[i].punto;
    const b = etapas[i + 1].punto;
    tramos.push(a && b ? estimarTraslado(a, b, modos, personas) : null);
  }
  return tramos;
}

export function nochesDeEtapa(etapas: readonly { dias: number }[], i: number): number {
  return i === etapas.length - 1 ? Math.max(0, etapas[i].dias - 1) : etapas[i].dias;
}

export function alojamientoDe(etapas: readonly { dias: number; alojamiento_noche_eur: number }[]): number {
  return etapas.reduce((s, e, i) => s + nochesDeEtapa(etapas, i) * e.alojamiento_noche_eur, 0);
}

// Franjas del día de llegada que tienen que quedar libres: la primera, y la
// segunda si el traslado pasa de 4 h. Devuelve (día, franja_id) con paradas.
export function llegadasOcupadas(dias: readonly Pick<Dia, "franjas" | "paradas">[], etapas: readonly { dias: number }[], tramos: readonly (Traslado | null)[]): { dia: number; franja_id: string }[] {
  const ocupadas: { dia: number; franja_id: string }[] = [];
  let inicio = 0;
  for (let i = 0; i < etapas.length; i++) {
    if (i > 0) {
      const dia = dias[inicio];
      const largo = (tramos[i - 1]?.duracion_min ?? 0) > TOPE_TIERRA_MIN;
      const libres = dia ? dia.franjas.slice(0, largo ? 2 : 1) : [];
      for (const f of libres) if (dia.paradas.some((p) => p.franja_id === f.id)) ocupadas.push({ dia: inicio, franja_id: f.id });
    }
    inicio += etapas[i].dias;
  }
  return ocupadas;
}

export function validarEtapas(etapas: readonly EtapaGeo[], ctx: ContextoEtapas, dias: readonly Pick<Dia, "franjas" | "paradas">[] = []): ErrorEtapa[] {
  const errores: ErrorEtapa[] = [];
  const n = etapas.length;
  const tope = maxEtapas(ctx.diasTotales);

  if (n === 0) return [{ codigo: "zona-sin-etapa", texto: "El plan no tiene ninguna etapa." }];
  if (n > tope) errores.push({ codigo: "dias", texto: `${n} etapas son demasiadas para ${ctx.diasTotales} días: el máximo es ${tope}.` });
  const suma = etapas.reduce((s, e) => s + e.dias, 0);
  if (suma !== ctx.diasTotales) errores.push({ codigo: "dias", texto: `Las etapas suman ${suma} días y el viaje tiene ${ctx.diasTotales}.` });

  const vistas = new Set<string>();
  for (const e of etapas) {
    const clave = normalizarNombre(e.ciudad);
    if (vistas.has(clave)) errores.push({ codigo: "dias", texto: `${e.ciudad} aparece en más de una etapa.` });
    vistas.add(clave);
    if (ctx.diasTotales > VIAJE_CORTO_DIAS && e.dias < MIN_DIAS_ETAPA) {
      errores.push({ codigo: "dias", texto: `${e.ciudad}: ${e.dias} ${e.dias === 1 ? "día" : "días"}, el mínimo es ${MIN_DIAS_ETAPA}.` });
    }
    if (!e.punto) errores.push({ codigo: "zona-sin-etapa", texto: `No hemos podido situar ${e.ciudad} en el mapa.` });
    else if (e.zona === null) errores.push({ codigo: "zona-sin-etapa", texto: `${e.ciudad} no está dentro de ninguna de las zonas que has pedido.` });
  }

  for (let z = 0; z < ctx.zonas.length; z++) {
    if (!etapas.some((e) => e.zona === z)) errores.push({ codigo: "zona-sin-etapa", texto: `No hemos podido incluir ${ctx.zonas[z].nombre} con estas reglas.` });
  }

  const tramos = trasladosDe(etapas, ctx.modos, ctx.personas);
  tramos.forEach((t, i) => {
    if (t || !etapas[i].punto || !etapas[i + 1].punto) return;
    const conAvion = ctx.modos.length === 0 || ctx.modos.includes("avion");
    errores.push({
      codigo: "distancia",
      texto: `${etapas[i].ciudad} → ${etapas[i + 1].ciudad}: no hay forma de ir en menos de ${TOPE_TIERRA_MIN / 60} h por tierra${conAvion ? ` ni ${TOPE_AVION_MIN / 60} h en avión` : ""} con los medios elegidos.`,
    });
  });

  if (dias.length > 0 && tramos.every((t) => t !== null)) {
    for (const o of llegadasOcupadas(dias, etapas, tramos)) {
      errores.push({ codigo: "dias", texto: `El día ${o.dia + 1} es de llegada y la franja ${o.franja_id} tiene que quedar libre.` });
    }
  }

  if (tramos.every((t) => t !== null)) {
    const alojamiento = alojamientoDe(etapas);
    const traslados = tramos.reduce((s, t) => s + (t?.coste_eur ?? 0), 0);
    const total = alojamiento + traslados + ctx.actividadesEur;
    if (total > ctx.presupuestoEur) {
      errores.push({
        codigo: "presupuesto",
        texto: `El viaje cuesta ~${euros(total)} (alojamiento ~${euros(alojamiento)}, traslados ~${euros(traslados)}, visitas ~${euros(ctx.actividadesEur)}) y tu presupuesto es de ${euros(ctx.presupuestoEur)}.`,
      });
    }
  }
  return errores;
}

type Resultado = { etapas: EtapaGeo[]; cambio: boolean };

// Quita la etapa i y reparte sus días entre las vecinas de su zona (la
// anterior primero); si no hay vecina de su zona, entre la anterior o la
// siguiente. Nunca se llama si la etapa es la única de su zona.
function quitar(etapas: EtapaGeo[], i: number, razon: string): EtapaGeo[] {
  const quitada = etapas[i];
  const mismaZona = (j: number) => j >= 0 && j < etapas.length && j !== i && etapas[j].zona === quitada.zona;
  const receptora = [i - 1, i + 1].find(mismaZona) ?? [i - 1, i + 1].find((j) => j >= 0 && j < etapas.length) ?? -1;
  const resto = etapas.map((e) => ({ ...e, ajustes: [...e.ajustes] }));
  if (receptora !== -1) {
    resto[receptora].dias += quitada.dias;
    resto[receptora].ajustes.push(`Se ha quitado ${quitada.ciudad} (${razon}) y sus ${quitada.dias} ${quitada.dias === 1 ? "día pasa" : "días pasan"} a ${resto[receptora].ciudad}.`);
  }
  resto.splice(i, 1);
  return resto;
}

const zonasConVarias = (etapas: readonly EtapaGeo[], z: number | null): boolean => z !== null && etapas.filter((e) => e.zona === z).length > 1;

// Un paso de reparación; devuelve cambio=false cuando ya no hay nada que
// arreglar de forma segura. Cada paso solo actúa sobre una violación, así que
// una entrada válida (o ya reparada) no cambia ni gana ajustes.
function pasoDeReparacion(etapas: EtapaGeo[], ctx: ContextoEtapas): Resultado {
  const sin = (e: EtapaGeo[]): Resultado => ({ etapas: e, cambio: true });

  // 1. Ciudades que no se pueden situar o repetidas.
  const vistas = new Set<string>();
  for (let i = 0; i < etapas.length; i++) {
    const clave = normalizarNombre(etapas[i].ciudad);
    if (!etapas[i].punto || etapas[i].zona === null) {
      if (etapas.length > 1 && (etapas[i].zona === null || zonasConVarias(etapas, etapas[i].zona))) return sin(quitar(etapas, i, "no se ha podido situar dentro de las zonas pedidas"));
    }
    if (vistas.has(clave) && etapas.length > 1) return sin(quitar(etapas, i, "está repetida"));
    vistas.add(clave);
  }

  // 2. Días que no suman el viaje: se ajusta la última etapa.
  const suma = etapas.reduce((s, e) => s + e.dias, 0);
  const ultimaDias = etapas.length > 0 ? etapas[etapas.length - 1].dias : 0;
  const nuevos = Math.max(1, ultimaDias + ctx.diasTotales - suma);
  if (suma !== ctx.diasTotales && etapas.length > 0 && nuevos !== ultimaDias) {
    const copia = etapas.map((e) => ({ ...e, ajustes: [...e.ajustes] }));
    const ultima = copia[copia.length - 1];
    ultima.ajustes.push(`Los días de ${ultima.ciudad} pasan de ${ultima.dias} a ${nuevos} para que las etapas cubran los ${ctx.diasTotales} días del viaje.`);
    ultima.dias = nuevos;
    return sin(copia);
  }

  // 3. Traslados imposibles: se quita la etapa de destino del tramo.
  const tramos = trasladosDe(etapas, ctx.modos, ctx.personas);
  for (let i = 0; i < tramos.length; i++) {
    if (tramos[i] || !etapas[i].punto || !etapas[i + 1].punto) continue;
    if (zonasConVarias(etapas, etapas[i + 1].zona)) return sin(quitar(etapas, i + 1, "el trayecto desde la etapa anterior es demasiado largo con los medios elegidos"));
    if (zonasConVarias(etapas, etapas[i].zona)) return sin(quitar(etapas, i, "el trayecto hasta la etapa siguiente es demasiado largo con los medios elegidos"));
  }

  // 4. Demasiadas etapas: se quita la última del orden del modelo entre las
  // de zonas con más de una.
  if (etapas.length > maxEtapas(ctx.diasTotales)) {
    for (let i = etapas.length - 1; i >= 0; i--) {
      if (zonasConVarias(etapas, etapas[i].zona)) return sin(quitar(etapas, i, `un viaje de ${ctx.diasTotales} días solo admite ${maxEtapas(ctx.diasTotales)} etapas`));
    }
  }

  // 5. Etapas de menos de 2 días: se quitan si su zona tiene otra; si no, se
  // amplían con un día de la vecina que más tenga.
  if (ctx.diasTotales > VIAJE_CORTO_DIAS) {
    for (let i = 0; i < etapas.length; i++) {
      if (etapas[i].dias >= MIN_DIAS_ETAPA) continue;
      if (zonasConVarias(etapas, etapas[i].zona)) return sin(quitar(etapas, i, `con ${etapas[i].dias} día el mínimo por etapa es ${MIN_DIAS_ETAPA}`));
      const donante = [i - 1, i + 1]
        .filter((j) => j >= 0 && j < etapas.length && etapas[j].dias > MIN_DIAS_ETAPA)
        .sort((a, b) => etapas[b].dias - etapas[a].dias || a - b)[0];
      if (donante !== undefined) {
        const copia = etapas.map((e) => ({ ...e, ajustes: [...e.ajustes] }));
        copia[donante].dias -= 1;
        copia[i].dias += 1;
        copia[i].ajustes.push(`${copia[i].ciudad} gana un día de ${copia[donante].ciudad} para llegar al mínimo de ${MIN_DIAS_ETAPA}.`);
        return sin(copia);
      }
    }
  }
  return { etapas, cambio: false };
}

export function repararEtapas(propuestas: readonly EtapaGeo[], ctx: ContextoEtapas): EtapaGeo[] {
  let etapas = propuestas.map((e) => ({ ...e, ajustes: [...e.ajustes] }));
  // Cada paso quita una etapa, mueve un día o fija la suma: el bucle termina.
  for (let paso = 0; paso < 100; paso++) {
    const r = pasoDeReparacion(etapas, ctx);
    if (!r.cambio) break;
    etapas = r.etapas;
  }
  return etapas;
}

export const textoAjusteLlegada = (ciudad: string, franja: string): string => `Se ha vaciado la franja ${franja} del día de llegada a ${ciudad} para descansar del traslado.`;
