import "server-only";
import { elegirMejorCandidato } from "./aceptacion";
import { limpiarNombreBusqueda, normalizarNombre } from "./normalizar";
import {
  crearPresupuestoPeticiones,
  FalloRedCiudad,
  PresupuestoAgotado,
  type CajaDelimitadora,
  type CandidatoLugar,
  type FuenteCiudad,
  type FuenteLugares,
  type PresupuestoPeticiones,
} from "./tipos";

// "multiciudad" (etapas-pais): el plan no tiene UNA ciudad efectiva; cada
// etapa guarda la suya en plan_versiones.etapas.
export type EstadoCiudad = "resuelta" | "pendiente-manual" | "sin-ciudad-identificable" | "multiciudad";
export type MetodoCiudad = "destino" | "paradas" | "manual";

export interface CandidatoCiudad {
  nombre: string;
  apoyo: number;
}

// bar-ac2/bar-ac4 (feedback del gatekeeper, 2026-10-04): un "sin-ciudad-
// identificable" no es una conclusión sobre el PLAN, es una conclusión
// sobre lo que supo decidir la lógica vigente cuando se escribió. Si esa
// lógica cambia (como en ciu-ac2), los planes ya marcados por una versión
// anterior se quedarían bloqueados para siempre -- bar-ac2 dice, con toda
// razón, que un "sin-ciudad-identificable" no genera peticiones, pero eso
// solo tiene sentido si el veredicto es el de la lógica ACTUAL. Subir este
// número cada vez que `elegirGanador`/`deducirPorParadas`/
// `intentarCajaDelDestino` cambien su criterio de decisión es lo que deja
// que esos planes se reintenten UNA vez (y solo una) en el siguiente tick.
//
// Subida a 3 (bar-ac4, feedback del gatekeeper, 2026-10-04): `elegirGanador`
// ya no devuelve "abarca una zona demasiado grande" cuando en realidad no
// hubo caja que verificar, y un rechazo en el nivel "ciudad" ya no cancela
// los niveles "distrito" y "región" -- los 27 planes reales sellados con la
// versión 2 (como el de "Londres en familia con niños", que el gatekeeper
// midió que SÍ resuelve con la lógica corregida) tienen que reintentarse
// una vez más contra esta versión del criterio.
//
// Subida a 4 (bar-ac4, feedback del gatekeeper, 2026-10-04): las claves de
// caché de `buscarLibre`/`geocodificarCiudad` en fuenteAbierta.ts no llevaban
// la versión del resolutor, así que un reintento contra la versión 3 podía
// seguir leyendo el resultado negativo que había escrito la lógica rota de
// la versión 1 o 2 -- el plan se resellaba sin haber preguntado nada de
// verdad. Ahora la clave incluye la versión, así que esta subida es la que
// de verdad fuerza una pregunta nueva a Nominatim para los planes sellados
// con una versión anterior (Londres incluido).
//
// Subida a 5 (bar-ac4, feedback del gatekeeper, 2026-10-04, ronda 7): nuevo
// escalón `intentarCandidatosDesdeTexto` entre la caja del destino entero y
// la deducción por paradas -- IMPRESCINDIBLE subir la versión en el MISMO
// commit, porque el reintento único de la versión 4 para los 3 planes
// sellados (categoria_motivo=sin-candidato-claro, Londres incluido) ya está
// gastado: sin esta subida, la clave de caché `ciudad:v4:...` del nivel de
// deducción seguiría siendo válida y el plan ni siquiera llegaría a probar
// el escalón nuevo con una pregunta real a Nominatim.
//
// Subida a 6 (bar-ac4, feedback del gatekeeper, 2026-10-04, ronda 8): medido
// contra el despliegue real por el gatekeeper, `ordenDeterminista` elegía la
// muestra de validación empezando por los nombres con MÁS tokens -- en un
// plan mixto eso llena la muestra con paradas descriptivas ("Tarde libre en
// familia por el centro de la ciudad") y nunca llega a los nombres de sitio
// cortos (monumentos), así que "Londres" se descartaba por 1 de 5 aceptadas
// en vez de 2. Ahora el orden prioriza POCOS tokens primero (más corto,
// luego alfabético) y la muestra de validación crece hasta encontrar 2
// aceptadas en vez de cortar siempre en 5 -- otra vez IMPRESCINDIBLE subir
// la versión en el mismo commit: el reintento único de la versión 5 para los
// 3 planes sellados por este mismo sesgo ya está gastado.
export const VERSION_RESOLUTOR_ACTUAL = 6;

// bar-ac4: categoría cerrada del motivo de sellado, para poder contar por
// tipo en /api/salud.relleno sin tener que hacer coincidir texto libre
// (dos motivos legítimos comparten subcadena: "no se pudo verificar
// geográficamente" y "no se pudo verificar geográficamente (sin caja)").
export type CategoriaMotivoSellado =
  | "pocas-paradas"
  | "sin-caja"
  | "zona-grande"
  | "sin-contencion"
  | "sin-ventaja"
  | "sin-candidato-claro"
  | "ciudad-no-encontrada";

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
  // bar-ac4: solo presente cuando estado es "sin-ciudad-identificable" --
  // la categoría cerrada del motivo, para contar por tipo sin parsear texto.
  categoria_motivo?: CategoriaMotivoSellado;
  motivo_destino_descartado?: string;
  candidatos?: CandidatoCiudad[];
  intentado_en: string;
  // bar-ac2/bar-ac4: con qué versión del resolutor se decidió este
  // veredicto. Ausente en todo lo escrito antes de este bloque (se trata
  // como "anterior a cualquier versión", nunca como "versión 0 válida").
  version_resolutor?: number;
  // bar-ac2/ciudad-a-mano: lo que el usuario escribió a mano cuando el estado es
  // "pendiente-manual" -- el barrido lo geocodifica en el siguiente tick
  // (bloque barrido-todos-los-planes); el endpoint que lo escribe es de un
  // bloque posterior, pero el campo tiene que existir ya para que el
  // barrido sepa qué texto pedirle a Nominatim.
  nombre_pedido?: string;
  // ciudad-a-mano (man-ac2/man-ac4): cuándo se pidió `nombre_pedido` --
  // es lo único contra lo que se mide la ventana de una hora de
  // pedirCiudadManual; distinto de `intentado_en`, que es cuándo el
  // barrido intentó (o intentará) resolverlo.
  pedido_en?: string;
}

const TAMANO_MUESTRA_DESTINO = 5;
const MUESTRA_MAXIMA_DESTINO = 12;
const MINIMO_ACEPTADAS_DESTINO = 2;
const MAXIMO_PARADAS_DEDUCCION = 8;
const MINIMO_PARADAS_DEDUCCION = 3;
const APOYO_MINIMO = 3;
const PROPORCION_MINIMA = 0.5;
const VENTAJA_MINIMA = 2;
const SPAN_MAXIMO_GRADOS = 2;
const MINIMO_PARADAS_VOTANTES_EN_CAJA = 2;
// cpn-ac1: peticiones de red a Nominatim por plan, compartidas por todos los
// peldaños de la escalera. La deducción antigua llegaba a 61 en un plan de
// 24 paradas; con la caché llena lo que no cupo se completa en el siguiente
// intento sin gastar nada, así que el tope solo reparte el trabajo en ticks.
export const PETICIONES_MAXIMAS_POR_PLAN = 12;
// Con menos votos que esto un tope agotado no basta para nombrar una ciudad.
const MINIMO_VOTOS_PRESUPUESTO_AGOTADO = 3;

type NivelDireccion = "ciudad" | "distrito" | "region";

// ciu-ac2/invariante de orden -- reordenado en bar-ac4 (feedback del
// gatekeeper, 2026-10-04, ronda 8): deduplica por nombre normalizado (se
// queda con la primera grafía original encontrada) y ordena por MENOS
// tokens primero, luego más CORTO, luego alfabético. Es un orden total que
// no depende de la posición de entrada (el invariante de permutación sigue
// cumpliéndose), pero ya no es el de ciu-ac2 ("más tokens, luego más
// largo"): esa letra se escribió asumiendo que un nombre largo y
// descriptivo era tan buen candidato de muestra como uno corto, y medido
// contra Nominatim real no lo es -- los nombres de SITIO (los que de verdad
// geocodifican) son casi siempre los más cortos ("Hyde Park" frente a
// "Tarde libre en familia por el centro de la ciudad"). Desviación
// declarada en `desviaciones` del entregable de esta pasada.
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
    if (tokensA !== tokensB) return tokensA - tokensB;
    if (claveA.length !== claveB.length) return claveA.length - claveB.length;
    return claveA < claveB ? -1 : claveA > claveB ? 1 : 0;
  });
  return distintos.map(([, original]) => original);
}

function clavesDeNivel(direccion: CandidatoLugar["direccion"], nivel: NivelDireccion): string[] {
  if (!direccion) return [];
  // nivel "distrito": state_district/county son los campos "de libro" de
  // Nominatim, pero para Londres (y otras ciudades con boroughs) la API
  // real no los rellena -- usa borough/city_district/suburb en su lugar
  // (verificado contra la API real el 2026-10-04). Se prueban en ese
  // orden, de más administrativo a más local.
  const valores =
    nivel === "ciudad"
      ? [direccion.city, direccion.town, direccion.village, direccion.municipality]
      : nivel === "distrito"
        ? [direccion.state_district, direccion.county, direccion.borough, direccion.city_district, direccion.suburb]
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
  ordenados: CandidatoCiudad[];
  votantesDe: Map<string, VotoParada[]>;
  nConsultadas: number;
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

  return { ordenados, votantesDe, nConsultadas };
}

interface Ganador {
  nombre: string;
  apoyo: number;
  caja: CajaDelimitadora;
  top3: CandidatoCiudad[];
}

interface GanadorRechazado {
  nombre: string;
  motivo: string;
  categoria: CategoriaMotivoSellado;
  top3: CandidatoCiudad[];
}

// ciu-ac2, calibrado con datos reales (feedback del gatekeeper del
// 2026-10-04): con direcciones REALES de Nominatim, una ciudad grande con
// "ciudades" internas (Londres/"City of Westminster") reparte el voto de
// nivel "ciudad" entre la ciudad grande y su sub-ciudad sin que ninguna
// llegue a la ventaja mínima -- y el nivel "distrito" (boroughs) no ayuda
// porque cada borough individual tampoco llega a la ventaja. La votación
// por mayoría simple no basta; hace falta la prueba de CONTENCIÓN
// geográfica: si la caja verificada del primero contiene también las
// coordenadas de las paradas que votaron al segundo, el segundo no es un
// candidato rival, es una subdivisión del primero (Westminster está
// dentro de Gran Londres), así que el primero gana sin exigir ventaja.
async function elegirGanador(fuente: FuenteCiudad, escrutinio: Escrutinio): Promise<Ganador | { rechazado: GanadorRechazado } | null> {
  const primero = escrutinio.ordenados[0];
  if (!primero || primero.apoyo < APOYO_MINIMO || primero.apoyo < escrutinio.nConsultadas * PROPORCION_MINIMA) {
    return null;
  }

  const top3 = escrutinio.ordenados.slice(0, 3);
  const paradasVotantesPrimero = escrutinio.votantesDe.get(primero.nombre) ?? [];
  const caja = await fuente.geocodificarCiudad(primero.nombre);
  const paradasDentro = caja ? paradasVotantesPrimero.filter((voto) => enCaja(voto.candidato, caja)).length : 0;

  // bar-ac4 (feedback del gatekeeper, 2026-10-04): antes estos dos casos
  // compartían el mismo motivo ("abarca una zona demasiado grande"), que es
  // justo lo que el usuario lee en el aviso de ciudad-a-mano -- y es FALSO
  // cuando lo que pasó es que `geocodificarCiudad` no devolvió caja (no se
  // pudo verificar, no que la zona fuera grande). Con datos reales esto
  // importa: dice cuál de las dos ramas se tomó de verdad.
  if (!caja) {
    return { rechazado: { nombre: primero.nombre, motivo: `la ciudad candidata «${primero.nombre}» no se pudo verificar geográficamente (sin caja)`, categoria: "sin-caja", top3 } };
  }
  if (!spanValido(caja)) {
    return { rechazado: { nombre: primero.nombre, motivo: `la ciudad candidata «${primero.nombre}» abarca una zona demasiado grande`, categoria: "zona-grande", top3 } };
  }
  if (paradasDentro < MINIMO_PARADAS_VOTANTES_EN_CAJA) {
    return { rechazado: { nombre: primero.nombre, motivo: `la ciudad candidata «${primero.nombre}» no se pudo verificar geográficamente`, categoria: "sin-contencion", top3 } };
  }

  const segundo = escrutinio.ordenados[1];
  const ventajaSuficiente = primero.apoyo - (segundo?.apoyo ?? 0) >= VENTAJA_MINIMA;
  const votantesSegundo = segundo ? escrutinio.votantesDe.get(segundo.nombre) ?? [] : [];
  const segundoContenido = votantesSegundo.length > 0 && votantesSegundo.some((voto) => enCaja(voto.candidato, caja));

  if (!ventajaSuficiente && !segundoContenido) {
    return {
      rechazado: {
        nombre: primero.nombre,
        motivo: `la ciudad candidata «${primero.nombre}» no tiene ventaja suficiente sobre «${segundo?.nombre}»`,
        categoria: "sin-ventaja",
        top3,
      },
    };
  }

  return { nombre: primero.nombre, apoyo: primero.apoyo, caja, top3 };
}

function enCaja(candidato: CandidatoLugar, caja: CajaDelimitadora): boolean {
  return (
    candidato.lat >= caja.minLat &&
    candidato.lat <= caja.maxLat &&
    candidato.lon >= caja.minLon &&
    candidato.lon <= caja.maxLon
  );
}

// bar-ac4 (feedback del gatekeeper, 2026-10-04, ronda 7): una caja de 0x0
// grados no es una ciudad, es un único punto sin área -- medido contra
// Nominatim real: geocodificarDestino("Ciudad con niños") devuelve
// exactamente boundingbox [X,X,Y,Y]. Antes pasaba `spanValido` porque
// 0 <= SPAN_MAXIMO_GRADOS, y solo no causaba daño porque ninguna parada
// real cae dentro de un área de superficie cero. Exigir span > 0 en ambos
// ejes lo rechaza explícitamente en vez de confiar en ese efecto lateral.
function spanValido(caja: CajaDelimitadora): boolean {
  const spanLat = caja.maxLat - caja.minLat;
  const spanLon = caja.maxLon - caja.minLon;
  return spanLat > 0 && spanLon > 0 && spanLat <= SPAN_MAXIMO_GRADOS && spanLon <= SPAN_MAXIMO_GRADOS;
}

async function intentarCajaDelDestino(
  fuente: FuenteLugares,
  destino: string,
  nombresOrdenados: string[],
  ahora: string,
): Promise<CiudadEfectiva | { descartado: string }> {
  const bbox = await fuente.geocodificarDestino(destino);
  if (!bbox) return { descartado: "" };

  // bar-ac4 (feedback del gatekeeper, 2026-10-04, ronda 8): no cortar
  // siempre en TAMANO_MUESTRA_DESTINO -- con el nuevo orden (pocos tokens
  // primero) la mayoría de los planes aceptan ya en la muestra pequeña,
  // pero si no llega a las 2 aceptadas se sigue recorriendo hasta
  // MUESTRA_MAXIMA_DESTINO antes de rendirse. El presupuesto de 180 s por
  // tick lo permite y evita sellar un plan que sí tenía la información.
  const muestra = nombresOrdenados.slice(0, MUESTRA_MAXIMA_DESTINO);
  let aceptadas = 0;
  let intentadas = 0;
  let sinPresupuesto = false;
  for (const nombre of muestra) {
    let candidatos: CandidatoLugar[];
    try {
      candidatos = await fuente.buscarNominatim(limpiarNombreBusqueda(nombre), destino, bbox);
    } catch (error) {
      if (!(error instanceof PresupuestoAgotado)) throw error;
      sinPresupuesto = true;
      break;
    }
    intentadas++;
    const elegido = elegirMejorCandidato(nombre, candidatos, bbox);
    if (elegido.candidato) aceptadas++;
    if (aceptadas >= MINIMO_ACEPTADAS_DESTINO && intentadas >= TAMANO_MUESTRA_DESTINO) break;
  }

  if (aceptadas >= MINIMO_ACEPTADAS_DESTINO && spanValido(bbox)) {
    return { estado: "resuelta", metodo: "destino", nombre: destino, caja: bbox, intentado_en: ahora };
  }
  if (aceptadas >= MINIMO_ACEPTADAS_DESTINO) {
    return { descartado: `la caja del destino «${destino}» abarca una zona demasiado grande` };
  }
  // Un «no resolvió ninguna parada» por haberse quedado sin presupuesto no es
  // una conclusión sobre el destino: se pasa al siguiente peldaño.
  if (sinPresupuesto) throw new PresupuestoAgotado("la muestra del destino no cabe en el presupuesto");
  return { descartado: `la caja del destino no resolvió ninguna parada (${aceptadas} de ${intentadas})` };
}

// bar-ac4 (feedback del gatekeeper, 2026-10-04, ronda 7): colas
// cualificadoras conocidas que el usuario antepone/pospone al nombre real de
// la ciudad en un destino descriptivo. De más larga a más corta para que
// "en familia con niños" se quite entera antes que "con niños" sola.
const COLAS_CUALIFICADORAS_DESTINO = [
  "en familia con niños",
  "en familia con ninos",
  "de fin de semana",
  "en familia",
  "con niños",
  "con ninos",
  "con amigos",
  "en pareja",
  "low cost",
].sort((a, b) => b.length - a.length);

function escaparRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// bar-ac4 (feedback del gatekeeper, 2026-10-04, ronda 7): genera hasta 3
// candidatos de nombre de ciudad A PARTIR del texto del destino, para el
// escalón intermedio `intentarCandidatosDesdeTexto`. Dos estrategias, en
// este orden: (1) quitar colas cualificadoras conocidas del final del
// texto, repitiendo hasta que no quede ninguna ("Londres en familia con
// niños" -> "Londres"); (2) prefijos por token (primero 1, luego 2) para
// los destinos sin una cola reconocida. Nunca se devuelve el destino
// completo tal cual -- eso ya lo prueba `intentarCajaDelDestino` antes.
function candidatosDesdeTextoDestino(destino: string): string[] {
  const destinoNormalizado = destino.trim();
  const candidatos: string[] = [];
  const agregar = (valor: string) => {
    const limpio = valor.trim();
    if (limpio.length > 0 && limpio !== destinoNormalizado && !candidatos.includes(limpio)) candidatos.push(limpio);
  };

  let sinCola = destinoNormalizado;
  let cambiado = true;
  while (cambiado) {
    cambiado = false;
    for (const cola of COLAS_CUALIFICADORAS_DESTINO) {
      const regex = new RegExp(`\\s+${escaparRegExp(cola)}$`, "i");
      if (regex.test(sinCola)) {
        sinCola = sinCola.replace(regex, "").trim();
        cambiado = true;
      }
    }
  }
  agregar(sinCola);

  const tokens = destinoNormalizado.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) agregar(tokens[0]);
  if (tokens.length > 2) agregar(tokens.slice(0, 2).join(" "));

  return candidatos.slice(0, 3);
}

// bar-ac4 (feedback del gatekeeper, 2026-10-04, ronda 7): el escalón que
// faltaba entre "caja del destino entero" y "deducción por paradas".
// Medido contra Nominatim real: geocodificarDestino/geocodificarCiudad del
// texto entero "Londres en familia con niños" no devuelven caja, pero
// geocodificarCiudad("Londres") sí -- la ciudad nombrada en el destino está
// a una sola petición de distancia y la escalera nunca la pedía. La
// validación contra la MISMA muestra de 5 paradas que usa
// `intentarCajaDelDestino` no es opcional: geocodificarCiudad("Ciudad")
// TAMBIÉN devuelve una caja real (de un asentamiento que se llama así),
// así que aceptar la caja de un candidato sin comprobar que resuelve
// paradas de verdad sería peor que sellar el plan.
async function intentarCandidatosDesdeTexto(
  fuente: FuenteLugares & FuenteCiudad,
  destino: string,
  nombresOrdenados: string[],
): Promise<{ nombre: string; caja: CajaDelimitadora } | null> {
  // bar-ac4 (ronda 8): mismo crecimiento de muestra que intentarCajaDelDestino
  // -- ver su comentario.
  const muestra = nombresOrdenados.slice(0, MUESTRA_MAXIMA_DESTINO);

  for (const candidato of candidatosDesdeTextoDestino(destino)) {
    const caja = await fuente.geocodificarCiudad(candidato);
    if (!caja || !spanValido(caja)) continue;

    let aceptadas = 0;
    let intentadas = 0;
    for (const nombre of muestra) {
      intentadas++;
      const candidatosLugar = await fuente.buscarNominatim(limpiarNombreBusqueda(nombre), candidato, caja);
      if (elegirMejorCandidato(nombre, candidatosLugar, caja).candidato) aceptadas++;
      if (aceptadas >= MINIMO_ACEPTADAS_DESTINO && intentadas >= TAMANO_MUESTRA_DESTINO) break;
    }
    if (aceptadas >= MINIMO_ACEPTADAS_DESTINO) return { nombre: candidato, caja };
  }
  return null;
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
      categoria_motivo: "pocas-paradas",
      intentado_en: ahora,
      ...(motivoDestinoDescartado ? { motivo_destino_descartado: motivoDestinoDescartado } : {}),
    };
  }

  const consultadas = nombresOrdenados.slice(0, MAXIMO_PARADAS_DEDUCCION);
  const votosPorParada: VotoParada[][] = [];
  let sinPresupuesto = false;
  for (const nombre of consultadas) {
    let candidatos: CandidatoLugar[];
    try {
      candidatos = await fuente.buscarLibre(limpiarNombreBusqueda(nombre));
    } catch (error) {
      if (!(error instanceof PresupuestoAgotado)) throw error;
      sinPresupuesto = true;
      break;
    }
    votosPorParada.push(candidatos.slice(0, 3).map((candidato, indice) => ({ indice, claves: new Set<string>(), candidato })));
  }
  if (sinPresupuesto && votosPorParada.length < MINIMO_VOTOS_PRESUPUESTO_AGOTADO) {
    throw new PresupuestoAgotado("menos de 3 paradas votadas dentro del presupuesto");
  }
  // Con el presupuesto agotado se decide con las paradas que sí votaron:
  // el umbral de proporción se mide contra ellas, no contra las 8 previstas.
  const nConsultadas = votosPorParada.length;

  // bar-ac4 (feedback del gatekeeper, 2026-10-04): un ganador RECHAZADO en
  // un nivel no cancela los dos siguientes -- la arquitectura describe una
  // escalera de TRES niveles (ciudad -> distrito -> región), y antes un
  // rechazo en "ciudad" devolvía sin-ciudad-identificable sin probar nunca
  // "distrito" ni "región". Solo se devuelve el negativo al agotar los
  // tres, con el motivo del ÚLTIMO rechazo (el del nivel más específico
  // que llegó a tener un ganador, aunque no se pudiera aceptar).
  let ultimoRechazo: GanadorRechazado | undefined;
  for (const nivel of ["ciudad", "distrito", "region"] as const) {
    const escrutinio = escrutar(votosPorParada, nivel, nConsultadas);
    const resultado = await elegirGanador(fuente, escrutinio);
    if (resultado === null) continue;

    if ("rechazado" in resultado) {
      ultimoRechazo = resultado.rechazado;
      continue;
    }

    return {
      estado: "resuelta",
      metodo: "paradas",
      nombre: resultado.nombre,
      nivel,
      apoyo: resultado.apoyo,
      caja: resultado.caja,
      intentado_en: ahora,
      ...(motivoDestinoDescartado ? { motivo_destino_descartado: motivoDestinoDescartado } : {}),
    };
  }

  // Un negativo con votos a medias no es un veredicto: sin presupuesto no se
  // sella el plan como «sin ciudad identificable», se reintenta con la caché.
  if (sinPresupuesto) throw new PresupuestoAgotado("deducción por paradas sin conclusión dentro del presupuesto");

  if (ultimoRechazo) {
    return {
      estado: "sin-ciudad-identificable",
      motivo: ultimoRechazo.motivo,
      categoria_motivo: ultimoRechazo.categoria,
      candidatos: ultimoRechazo.top3,
      intentado_en: ahora,
      ...(motivoDestinoDescartado ? { motivo_destino_descartado: motivoDestinoDescartado } : {}),
    };
  }

  const escrutinioCiudad = escrutar(votosPorParada, "ciudad", nConsultadas);
  const candidatos = escrutinioCiudad.ordenados.slice(0, 3);
  const resumen = candidatos.map((c) => `${c.nombre} ${c.apoyo}`).join(", ");
  return {
    estado: "sin-ciudad-identificable",
    motivo: `no hay una ciudad clara (${resumen})`,
    categoria_motivo: "sin-candidato-claro",
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
  fuenteBase: FuenteLugares & FuenteCiudad,
  destino: string,
  nombresParadas: string[],
  presupuesto: PresupuestoPeticiones = crearPresupuestoPeticiones(PETICIONES_MAXIMAS_POR_PLAN),
): Promise<CiudadEfectiva | null> {
  const ahora = new Date().toISOString();
  const nombresOrdenados = ordenDeterminista(nombresParadas);
  // Una fuente sin caché ni red (los dobles de test) no tiene nada que
  // descontar y se usa tal cual.
  const fuente = fuenteBase.conPresupuesto ? fuenteBase.conPresupuesto(presupuesto) : fuenteBase;
  // Un peldaño que se queda sin presupuesto cede al siguiente; si ninguno
  // concluye algo positivo, el resultado es «inconcluso» (null), igual que un
  // fallo de red: el siguiente intento parte de una caché ya más llena.
  let sinPresupuesto = false;

  try {
    let porDestino: CiudadEfectiva | { descartado: string } | undefined;
    try {
      porDestino = await intentarCajaDelDestino(fuente, destino, nombresOrdenados, ahora);
    } catch (error) {
      if (!(error instanceof PresupuestoAgotado)) throw error;
      sinPresupuesto = true;
    }
    if (porDestino && "estado" in porDestino) return { ...porDestino, version_resolutor: VERSION_RESOLUTOR_ACTUAL };

    let porCandidatoDeTexto: { nombre: string; caja: CajaDelimitadora } | null = null;
    try {
      porCandidatoDeTexto = await intentarCandidatosDesdeTexto(fuente, destino, nombresOrdenados);
    } catch (error) {
      if (!(error instanceof PresupuestoAgotado)) throw error;
      sinPresupuesto = true;
    }
    if (porCandidatoDeTexto) {
      return {
        estado: "resuelta",
        metodo: "destino",
        nombre: porCandidatoDeTexto.nombre,
        caja: porCandidatoDeTexto.caja,
        intentado_en: ahora,
        version_resolutor: VERSION_RESOLUTOR_ACTUAL,
      };
    }

    const motivoDestinoDescartado = porDestino && porDestino.descartado.length > 0 ? porDestino.descartado : undefined;
    const resultado = await deducirPorParadas(fuente, nombresOrdenados, ahora, motivoDestinoDescartado);
    // Los peldaños anteriores no llegaron a probarse del todo: un negativo
    // ahora sería un veredicto sobre información incompleta.
    if (sinPresupuesto && resultado.estado !== "resuelta") return null;
    return { ...resultado, version_resolutor: VERSION_RESOLUTOR_ACTUAL };
  } catch (error) {
    if (error instanceof FalloRedCiudad || error instanceof PresupuestoAgotado) return null;
    throw error;
  }
}
