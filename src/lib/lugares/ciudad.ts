import "server-only";
import { elegirMejorCandidato } from "./aceptacion";
import { limpiarNombreBusqueda, normalizarNombre } from "./normalizar";
import { FalloRedCiudad, type CajaDelimitadora, type CandidatoLugar, type FuenteCiudad, type FuenteLugares } from "./tipos";

export type EstadoCiudad = "resuelta" | "pendiente-manual" | "sin-ciudad-identificable";
export type MetodoCiudad = "destino" | "paradas" | "manual";

export interface CandidatoCiudad {
  nombre: string;
  apoyo: number;
}

// ciu-ac1..ciu-ac2: la "ciudad efectiva" de un plan -- persistida tal cual
// en planes.ciudad (jsonb). `apoyo`/`nivel` solo tienen sentido cuando
// metodo es "paradas"; `motivo_destino_descartado` es la traza intermedia
// de por qué se abandonó la caja del destino antes de deducir por paradas
// (ausente si el destino ni siquiera geocodificó, o si resolvió a la
// primera).
export interface CiudadEfectiva {
  estado: EstadoCiudad;
  nombre?: string;
  metodo?: MetodoCiudad;
  caja?: CajaDelimitadora;
  apoyo?: number;
  nivel?: string;
  motivo?: string;
  motivo_destino_descartado?: string;
  candidatos?: CandidatoCiudad[];
  intentado_en: string;
}

const TAMANO_MUESTRA_DESTINO = 5;
const MINIMO_ACEPTADAS_DESTINO = 2;
const MAXIMO_PARADAS_DEDUCCION = 8;
const MINIMO_PARADAS_DEDUCCION = 3;
const APOYO_MINIMO = 3;
const PROPORCION_MINIMA = 0.5;
const VENTAJA_MINIMA = 2;
const SPAN_MAXIMO_GRADOS = 2;
const MINIMO_PARADAS_VOTANTES_EN_CAJA = 2;

type NivelDireccion = "ciudad" | "distrito" | "region";

// ciu-ac2/invariante de orden: deduplica por nombre normalizado (se queda
// con la primera grafía original encontrada) y ordena por más tokens,
// luego más largo, luego alfabético -- un orden total que no depende de la
// posición de entrada, así que permutar la lista de origen nunca cambia el
// resultado.
function ordenDeterminista(nombres: string[]): string[] {
  const vistos = new Map<string, string>();
  for (const nombre of nombres) {
    const clave = normalizarNombre(nombre);
    if (clave.length > 0 && !vistos.has(clave)) vistos.set(clave, nombre);
  }
  const distintos = [...vistos.entries()];
  distintos.sort(([claveA], [claveB]) => {
    const tokensA = claveA.split(" ").filter(Boolean).length;
    const tokensB = claveB.split(" ").filter(Boolean).length;
    if (tokensA !== tokensB) return tokensB - tokensA;
    if (claveA.length !== claveB.length) return claveB.length - claveA.length;
    return claveA < claveB ? -1 : claveA > claveB ? 1 : 0;
  });
  return distintos.map(([, original]) => original);
}

function clavesDeNivel(direccion: CandidatoLugar["direccion"], nivel: NivelDireccion): string[] {
  if (!direccion) return [];
  const valores =
    nivel === "ciudad"
      ? [direccion.city, direccion.town, direccion.village, direccion.municipality]
      : nivel === "distrito"
        ? [direccion.state_district, direccion.county]
        : [direccion.state, direccion.region];
  const primero = valores.find((valor) => !!valor && valor.trim().length > 0);
  return primero ? [primero] : [];
}

interface VotoParada {
  indice: number;
  claves: Set<string>;
  candidato: CandidatoLugar;
}

interface Escrutinio {
  ganador: string | null;
  apoyo: number;
  paradasVotantes: VotoParada[];
  top3: CandidatoCiudad[];
}

function escrutar(votosPorParada: VotoParada[][], nivel: NivelDireccion, nConsultadas: number): Escrutinio {
  const tally = new Map<string, Set<number>>();
  const votantesDe = new Map<string, VotoParada[]>();

  votosPorParada.forEach((votos, indiceParada) => {
    const clavesDeEstaParada = new Set<string>();
    for (const voto of votos) {
      for (const clave of clavesDeNivel(voto.candidato.direccion, nivel)) {
        clavesDeEstaParada.add(clave);
      }
    }
    for (const clave of clavesDeEstaParada) {
      if (!tally.has(clave)) tally.set(clave, new Set());
      tally.get(clave)!.add(indiceParada);
      if (!votantesDe.has(clave)) votantesDe.set(clave, []);
      const votoDeEstaParada = votos.find((v) => clavesDeNivel(v.candidato.direccion, nivel).includes(clave));
      if (votoDeEstaParada) votantesDe.get(clave)!.push(votoDeEstaParada);
    }
  });

  const ordenados = [...tally.entries()]
    .map(([nombre, paradas]) => ({ nombre, apoyo: paradas.size }))
    .sort((a, b) => (b.apoyo !== a.apoyo ? b.apoyo - a.apoyo : a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));

  const top3 = ordenados.slice(0, 3);
  const primero = ordenados[0];
  const segundo = ordenados[1];

  const esGanador =
    !!primero &&
    primero.apoyo >= APOYO_MINIMO &&
    primero.apoyo >= nConsultadas * PROPORCION_MINIMA &&
    primero.apoyo - (segundo?.apoyo ?? 0) >= VENTAJA_MINIMA;

  return {
    ganador: esGanador ? primero.nombre : null,
    apoyo: primero?.apoyo ?? 0,
    paradasVotantes: esGanador ? (votantesDe.get(primero.nombre) ?? []) : [],
    top3,
  };
}

function enCaja(candidato: CandidatoLugar, caja: CajaDelimitadora): boolean {
  return (
    candidato.lat >= caja.minLat &&
    candidato.lat <= caja.maxLat &&
    candidato.lon >= caja.minLon &&
    candidato.lon <= caja.maxLon
  );
}

function spanValido(caja: CajaDelimitadora): boolean {
  return caja.maxLat - caja.minLat <= SPAN_MAXIMO_GRADOS && caja.maxLon - caja.minLon <= SPAN_MAXIMO_GRADOS;
}

async function intentarCajaDelDestino(
  fuente: FuenteLugares,
  destino: string,
  nombresOrdenados: string[],
  ahora: string,
): Promise<CiudadEfectiva | { descartado: string }> {
  const bbox = await fuente.geocodificarDestino(destino);
  if (!bbox) return { descartado: "" };

  const muestra = nombresOrdenados.slice(0, TAMANO_MUESTRA_DESTINO);
  let aceptadas = 0;
  for (const nombre of muestra) {
    const candidatos = await fuente.buscarNominatim(limpiarNombreBusqueda(nombre), destino, bbox);
    const elegido = elegirMejorCandidato(nombre, candidatos, bbox);
    if (elegido.candidato) aceptadas++;
  }

  if (aceptadas >= MINIMO_ACEPTADAS_DESTINO && spanValido(bbox)) {
    return { estado: "resuelta", metodo: "destino", nombre: destino, caja: bbox, intentado_en: ahora };
  }
  if (aceptadas >= MINIMO_ACEPTADAS_DESTINO) {
    return { descartado: `la caja del destino «${destino}» abarca una zona demasiado grande` };
  }
  return { descartado: `la caja del destino no resolvió ninguna parada (${aceptadas} de ${muestra.length})` };
}

// ciu-ac2: deducción por voto de conjuntos sobre hasta 8 paradas. Cada
// parada vota como mucho UNA vez por nivel (conjunto, no multiset): una
// parada ambigua con 3 candidatos en la misma ciudad no pesa el triple.
async function deducirPorParadas(
  fuente: FuenteCiudad,
  nombresOrdenados: string[],
  ahora: string,
  motivoDestinoDescartado: string | undefined,
): Promise<CiudadEfectiva> {
  if (nombresOrdenados.length < MINIMO_PARADAS_DEDUCCION) {
    return {
      estado: "sin-ciudad-identificable",
      motivo: `no hay suficientes paradas para deducir la ciudad (${nombresOrdenados.length})`,
      intentado_en: ahora,
      ...(motivoDestinoDescartado ? { motivo_destino_descartado: motivoDestinoDescartado } : {}),
    };
  }

  const consultadas = nombresOrdenados.slice(0, MAXIMO_PARADAS_DEDUCCION);
  const votosPorParada: VotoParada[][] = [];
  for (const nombre of consultadas) {
    const candidatos = await fuente.buscarLibre(limpiarNombreBusqueda(nombre));
    votosPorParada.push(candidatos.slice(0, 3).map((candidato, indice) => ({ indice, claves: new Set<string>(), candidato })));
  }

  for (const nivel of ["ciudad", "distrito", "region"] as const) {
    const escrutinio = escrutar(votosPorParada, nivel, consultadas.length);
    if (!escrutinio.ganador) continue;

    const caja = await fuente.geocodificarCiudad(escrutinio.ganador);
    const paradasDentro = caja ? escrutinio.paradasVotantes.filter((voto) => enCaja(voto.candidato, caja)).length : 0;

    if (!caja || !spanValido(caja) || paradasDentro < MINIMO_PARADAS_VOTANTES_EN_CAJA) {
      return {
        estado: "sin-ciudad-identificable",
        motivo: caja && !spanValido(caja)
          ? `la ciudad candidata «${escrutinio.ganador}» abarca una zona demasiado grande`
          : `la ciudad candidata «${escrutinio.ganador}» no se pudo verificar geográficamente`,
        candidatos: escrutinio.top3,
        intentado_en: ahora,
        ...(motivoDestinoDescartado ? { motivo_destino_descartado: motivoDestinoDescartado } : {}),
      };
    }

    return {
      estado: "resuelta",
      metodo: "paradas",
      nombre: escrutinio.ganador,
      nivel,
      apoyo: escrutinio.apoyo,
      caja,
      intentado_en: ahora,
      ...(motivoDestinoDescartado ? { motivo_destino_descartado: motivoDestinoDescartado } : {}),
    };
  }

  const escrutinioCiudad = escrutar(votosPorParada, "ciudad", consultadas.length);
  const candidatos = escrutinioCiudad.top3;
  const resumen = candidatos.map((c) => `${c.nombre} ${c.apoyo}`).join(", ");
  return {
    estado: "sin-ciudad-identificable",
    motivo: `no hay una ciudad clara (${resumen})`,
    candidatos,
    intentado_en: ahora,
    ...(motivoDestinoDescartado ? { motivo_destino_descartado: motivoDestinoDescartado } : {}),
  };
}

// Núcleo del bloque ciudad-del-plan. Devuelve null cuando un fallo de RED
// (no una respuesta negativa) deja el resultado inconcluso -- el llamador
// no debe persistir nada ni marcar el plan como "sin ciudad identificable"
// en ese caso, solo reintentar más tarde (ciu-ac7).
export async function resolverCiudadEfectiva(
  fuente: FuenteLugares & FuenteCiudad,
  destino: string,
  nombresParadas: string[],
): Promise<CiudadEfectiva | null> {
  const ahora = new Date().toISOString();
  const nombresOrdenados = ordenDeterminista(nombresParadas);

  try {
    const porDestino = await intentarCajaDelDestino(fuente, destino, nombresOrdenados, ahora);
    if ("estado" in porDestino) return porDestino;

    const motivoDestinoDescartado = porDestino.descartado.length > 0 ? porDestino.descartado : undefined;
    return await deducirPorParadas(fuente, nombresOrdenados, ahora, motivoDestinoDescartado);
  } catch (error) {
    if (error instanceof FalloRedCiudad) return null;
    throw error;
  }
}
