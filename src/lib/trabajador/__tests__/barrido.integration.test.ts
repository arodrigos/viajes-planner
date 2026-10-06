import { beforeEach, describe, expect, it } from "vitest";
import { LimiteDeUsoAlcanzado, type EjecutorModelo, type ResultadoInvocacion } from "@/lib/trabajador/ejecutorModelo";
import { adquirirCerrojo, liberarCerrojo } from "@/lib/trabajador/cerrojo";
import { tick } from "@/lib/trabajador/tick";
import { clienteDePrueba } from "@/lib/db/clienteDePrueba";
import { guardarPlan } from "@/lib/plan/repositorio";
import type { CandidatoLugar, FuenteCiudad, FuenteLugares } from "@/lib/lugares/tipos";
import { VERSION_RESOLUTOR_ACTUAL, type CiudadEfectiva } from "@/lib/lugares/ciudad";
import { crearFuenteFotosGrabada } from "@/lib/lugares/fuenteFotosGrabada";
import type { FuenteCercanos } from "@/lib/alternativas/cercanos";
import type { Dia, Plan } from "@/lib/plan/tipos";
import { completarParadasPendientes } from "@/lib/trabajador/barrido";
import { FORMATO_GUIA } from "@/lib/guia/enriquecer";
import { rellenarCuriosidadesPendientes } from "@/lib/guia/curiosidadesPlan";
import { fuenteGrabada, sitiosLondres } from "@/lib/guia/__fixtures__/fuenteGrabada";
import type { FuenteGuia } from "@/lib/guia/wikivoyage";
import type { FichaGuia } from "@/lib/guia/wikitexto";

// fot-ac4: sin fixtures, ninguna llamada a Wikipedia/Commons de verdad --
// las paradas que este fichero resuelve vía Nominatim quedan con
// foto_intentada_en pero sin foto, que es justo lo que miden sus tests.
const FUENTE_FOTOS_SIN_RED = crearFuenteFotosGrabada({ paginas: {}, imagenes: {}, geosearch: {} });

// alt-ac1: este fichero no comprueba el tercer barrido (alternativas) --
// sin este doble, el tick por defecto crearía una fuente real de Overpass
// y las paradas que aquí se resuelven lanzarían peticiones de verdad.
const FUENTE_CERCANOS_SIN_RED: FuenteCercanos = { async buscar() { return []; } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DESTINO = "Valencia-barrido-test";
const BBOX = { minLat: 39, maxLat: 40, minLon: -1, maxLon: 0 };
const CIUDAD_RESUELTA: CiudadEfectiva = { estado: "resuelta", metodo: "destino", nombre: DESTINO, caja: BBOX, intentado_en: "2026-10-01T00:00:00Z" };

function candidato(nombre: string): CandidatoLugar {
  return {
    fuente: "osm",
    id: `osm:node/${nombre}`,
    url: `https://www.openstreetmap.org/node/${nombre}`,
    nombreFuente: nombre,
    nombresAlternativos: [],
    lat: 39.47,
    lon: -0.37,
    categoriaOsm: "historic",
    tipoOsm: "memorial",
    etiquetas: {},
  };
}

// Doble instrumentado: registra cada nombre por el que se preguntó a
// Nominatim, para comprobar tanto que un plan sin ciudad resuelta nunca
// consume peticiones (bar-ac2) como que una parada ya resuelta no vuelve a
// pedirse en un barrido posterior.
function fuenteInstrumentada(nominatim: Record<string, CandidatoLugar[]>): FuenteLugares & FuenteCiudad & { consultadas: string[] } {
  const consultadas: string[] = [];
  return {
    consultadas,
    async geocodificarDestino() {
      return BBOX;
    },
    async buscarNominatim(nombre: string) {
      consultadas.push(nombre);
      return nominatim[nombre] ?? [];
    },
    async buscarWikipedia() {
      return [];
    },
    async buscarLibre() {
      throw new Error("bar-ac1: este fichero siembra ciudad ya resuelta -- no debería deducirla por paradas");
    },
    async geocodificarCiudad() {
      throw new Error("bar-ac1: este fichero siembra ciudad ya resuelta -- no debería geocodificarla de nuevo");
    },
  };
}

function ejecutorQueFalla(): EjecutorModelo {
  return {
    async invocar(): Promise<ResultadoInvocacion> {
      throw new Error("rel-ac1: el barrido no debe invocar nunca al modelo");
    },
  };
}

function diaConParadas(nombres: string[], fecha: string): Dia {
  return {
    fecha,
    franjas: [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }],
    paradas: nombres.map((nombre) => ({
      id: `${nombre}-id`,
      franja_id: "manana",
      nombre,
      descripcion: "",
      duracion_min: 60,
      prioridad: 50,
      procedencia: { fuente: "propuesto-sin-verificar" },
      categoria: "monumento",
      // Sin coordenadas ni resolución: exactamente lo que deja un plan al
      // que todavía no le ha tocado el barrido (o cuyo intento caducó).
    })),
  };
}

interface OpcionesSiembra {
  eliminado?: boolean;
  sinTrabajo?: boolean;
  sinVersion?: boolean;
  fecha?: string;
  ciudad?: CiudadEfectiva | null;
}

// bar-ac1: el alcance ya no depende de `trabajos` -- se siembra con o sin
// trabajo, con o sin eliminado_en, y hasta sin ninguna versión, para
// comprobar las cuatro combinaciones del caso de prueba cp-bar-01.
async function sembrarPlan(
  supabase: ReturnType<typeof clienteDePrueba>,
  planId: string,
  nombres: string[],
  opciones: OpcionesSiembra = {},
): Promise<void> {
  if (opciones.sinVersion) {
    const { error } = await supabase.from("planes").insert({ id: planId, destino: DESTINO, ciudad: opciones.ciudad ?? null });
    if (error) throw new Error(`No se pudo sembrar el plan sin versión: ${error.message}`);
    return;
  }

  const plan: Plan = {
    id: planId,
    version: 1,
    destino: DESTINO,
    personas: 2,
    dias: [diaConParadas(nombres, opciones.fecha ?? "2026-11-01")],
    ...(opciones.ciudad !== undefined ? { ciudad: opciones.ciudad ?? undefined } : {}),
  };
  await guardarPlan(supabase, plan);
  if (opciones.ciudad === null) {
    // guardarPlan omite la clave `ciudad` cuando es undefined (para no
    // pisar una ya resuelta) -- este fichero necesita planes.ciudad
    // explícitamente en null para los casos que empiezan sin ciudad.
    await supabase.from("planes").update({ ciudad: null }).eq("id", planId);
  }
  if (opciones.sinTrabajo) return;
  const { error } = await supabase
    .from("trabajos")
    .insert({
      tipo: "generacion",
      criterios: { destino_o_tipo: DESTINO, fechas: { modo: "epoca", epoca: "otoño" }, dias: 1, personas: [{ edad: 30 }], perfil: "pareja", presupuesto_eur: 500 },
      estado: "completado",
      plan_id: planId,
      eliminado_en: opciones.eliminado ? new Date().toISOString() : null,
    });
  if (error) throw new Error(`No se pudo sembrar el trabajo de prueba: ${error.message}`);
}

describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("barrido de relleno (bar-ac1, bar-ac2, bar-ac5)", () => {
  const supabase = clienteDePrueba();

  beforeEach(async () => {
    await supabase.from("planes").delete().like("id", "plan-barrido-%");
    await supabase.from("cerrojo_trabajador").update({ tomado_por: null, tomado_hasta: null }).eq("id", 1);
    // Estos tests exigen cola vacía para que el barrido sea lo único que
    // el tick hace; otros ficheros de integración (cola/crear, por
    // ejemplo) encolan trabajos reales sin plan de prueba y sin
    // limpiarlos después, porque esa no es su preocupación. Como todos
    // los ficheros de integración golpean la misma Postgres en serie
    // (fileParallelism: false), cerrar aquí cualquier trabajo que haya
    // quedado no terminal de un fichero anterior es seguro: sus propias
    // aserciones ya corrieron.
    await supabase.from("trabajos").update({ estado: "completado" }).in("estado", ["encolado", "en-curso", "pausado-por-cuota"]);
    // Vitest no garantiza orden alfabético entre ficheros con
    // fileParallelism:false (depende de su propio scheduler); varios
    // ficheros de trabajador (cuota, validacion, aislamiento-criterios)
    // ejecutan procesarTrabajo de verdad contra el doble del fixture de 5
    // días y dejan un plan real, con paradas sin resolver, enlazado por un
    // `trabajos.plan_id` -- exactamente lo que este barrido recoge. Esos
    // ficheros ya completaron sus propias aserciones cuando este se
    // ejecuta (antes o después), así que barrer aquí cualquier plan que no
    // sea de este fichero es seguro y es lo único que da un recuento
    // determinista de "cuántas paradas pendientes hay".
    await supabase.from("planes").delete().not("id", "like", "plan-barrido-%");
  });

  it("cp-bar-01: cubre vivo, eliminado y sin-trabajo por igual; se salta el que no tiene versión; nunca invoca al modelo", async () => {
    await sembrarPlan(supabase, "plan-barrido-vivo", ["Monumento Uno", "Monumento Dos"], { ciudad: CIUDAD_RESUELTA });
    await sembrarPlan(supabase, "plan-barrido-eliminado", ["Monumento Tres"], { eliminado: true, ciudad: CIUDAD_RESUELTA });
    await sembrarPlan(supabase, "plan-barrido-sin-trabajo", ["Monumento Cuatro"], { sinTrabajo: true, ciudad: CIUDAD_RESUELTA });
    await sembrarPlan(supabase, "plan-barrido-sin-version", [], { sinVersion: true, ciudad: CIUDAD_RESUELTA });

    const nominatim: Record<string, CandidatoLugar[]> = {
      "Monumento Uno": [candidato("Monumento Uno")],
      "Monumento Dos": [candidato("Monumento Dos")],
      "Monumento Tres": [candidato("Monumento Tres")],
      "Monumento Cuatro": [candidato("Monumento Cuatro")],
    };
    const fuente = fuenteInstrumentada(nominatim);

    const resultado = await tick(supabase, {
      ejecutor: ejecutorQueFalla(),
      directorio: "/tmp",
      fuenteLugares: fuente,
      fuenteFotos: FUENTE_FOTOS_SIN_RED,
      fuenteCercanos: FUENTE_CERCANOS_SIN_RED,
      esperaOciosaMs: 0,
      intervaloOciosoMs: 10,
    });

    expect(resultado.trabajosProcesados).toBe(0);
    expect(fuente.consultadas).toEqual(
      expect.arrayContaining(["Monumento Uno", "Monumento Dos", "Monumento Tres", "Monumento Cuatro"]),
    );

    const { data: paradasCubiertas } = await supabase
      .from("paradas")
      .select("nombre, lat, lon, resolucion, lugar")
      .in("nombre", ["Monumento Uno", "Monumento Dos", "Monumento Tres", "Monumento Cuatro"]);
    expect(paradasCubiertas).toHaveLength(4);
    for (const parada of paradasCubiertas ?? []) {
      expect(parada.lat).toBeCloseTo(39.47);
      expect((parada.resolucion as { estado: string }).estado).toBe("resuelta");
    }
  });

  it("cp-bar-02: un plan 'sin-ciudad-identificable' sellado por la versión VIGENTE del resolutor consume cero peticiones en dos ticks seguidos y no toca su intentado_en", async () => {
    const intentadoEnOriginal = "2026-10-04T10:00:00Z";
    await sembrarPlan(supabase, "plan-barrido-sinciudad", Array.from({ length: 5 }, (_, i) => `Parada sin ciudad ${i}`), {
      ciudad: {
        estado: "sin-ciudad-identificable",
        motivo: "no hay una ciudad clara: Madrid 2, Valencia 2, Barcelona 1",
        intentado_en: intentadoEnOriginal,
        version_resolutor: VERSION_RESOLUTOR_ACTUAL,
      },
    });
    await sembrarPlan(supabase, "plan-barrido-sevilla", ["Parada Sevilla Reciente", "Parada Sevilla Vieja"], { ciudad: CIUDAD_RESUELTA });

    // Una parada "no-resuelta" reciente (hace 10 días) no se reintenta; una
    // de hace 40 días sí.
    const { data: filasSevilla } = await supabase
      .from("paradas")
      .select("id, nombre")
      .in("nombre", ["Parada Sevilla Reciente", "Parada Sevilla Vieja"]);
    const haceDiez = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const haceCuarenta = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    for (const fila of filasSevilla ?? []) {
      const intentadoEn = fila.nombre === "Parada Sevilla Reciente" ? haceDiez : haceCuarenta;
      await supabase.from("paradas").update({ resolucion: { estado: "no-resuelta", intentado_en: intentadoEn } }).eq("id", fila.id);
    }

    const nominatim: Record<string, CandidatoLugar[]> = {
      "Parada Sevilla Vieja": [candidato("Parada Sevilla Vieja")],
    };

    for (let i = 0; i < 2; i++) {
      const fuente = fuenteInstrumentada(nominatim);
      await tick(supabase, {
        ejecutor: ejecutorQueFalla(),
        directorio: "/tmp",
        fuenteLugares: fuente,
        fuenteFotos: FUENTE_FOTOS_SIN_RED,
        fuenteCercanos: FUENTE_CERCANOS_SIN_RED,
        esperaOciosaMs: 0,
        intervaloOciosoMs: 10,
      });
      expect(fuente.consultadas.some((n) => n.startsWith("Parada sin ciudad"))).toBe(false);
      expect(fuente.consultadas).not.toContain("Parada Sevilla Reciente");
    }

    const { data: planSinCiudad } = await supabase.from("planes").select("ciudad").eq("id", "plan-barrido-sinciudad").single();
    expect((planSinCiudad?.ciudad as CiudadEfectiva).intentado_en).toBe(intentadoEnOriginal);

    const { data: paradasSinCiudad } = await supabase.from("paradas").select("resolucion").in("nombre", Array.from({ length: 5 }, (_, i) => `Parada sin ciudad ${i}`));
    for (const parada of paradasSinCiudad ?? []) {
      expect(parada.resolucion).toBeNull();
    }

    const { data: viejaFinal } = await supabase.from("paradas").select("resolucion").eq("nombre", "Parada Sevilla Vieja").single();
    expect((viejaFinal?.resolucion as { estado: string }).estado).toBe("resuelta");
  });

  it("bar-ac4 (feedback 2026-10-04): un plan 'sin-ciudad-identificable' sellado por una versión ANTERIOR del resolutor se reintenta UNA vez, y si vuelve a fallar deja de reintentarse", async () => {
    const intentadoEnViejo = "2026-10-01T00:00:00Z";
    // Sin `version_resolutor` (lo que escribió cualquier resolutor previo a
    // este bloque): tiene que tratarse como "anterior a cualquier versión".
    await sembrarPlan(supabase, "plan-barrido-sello-viejo", ["Real Alcázar", "Catedral de Sevilla", "Plaza de España"], {
      ciudad: { estado: "sin-ciudad-identificable", motivo: "no hay una ciudad clara: Madrid 1, Valencia 1, Barcelona 1", intentado_en: intentadoEnViejo },
    });

    const nominatim: Record<string, CandidatoLugar[]> = {
      "Real Alcázar": [candidato("Real Alcázar")],
      "Catedral de Sevilla": [candidato("Catedral de Sevilla")],
      "Plaza de España": [candidato("Plaza de España")],
    };

    const primeraFuente = fuenteInstrumentada(nominatim);
    await tick(supabase, {
      ejecutor: ejecutorQueFalla(),
      directorio: "/tmp",
      fuenteLugares: primeraFuente,
      fuenteFotos: FUENTE_FOTOS_SIN_RED,
      fuenteCercanos: FUENTE_CERCANOS_SIN_RED,
      esperaOciosaMs: 0,
      intervaloOciosoMs: 10,
    });

    // El destino de prueba geocodifica siempre a BBOX y las 3 paradas
    // resuelven, así que el reintento sale "resuelta" -- lo que importa
    // aquí no es el resultado, sino que SÍ se gastó una petición y que el
    // nuevo veredicto queda sellado con la versión vigente.
    expect(primeraFuente.consultadas.length).toBeGreaterThan(0);

    const { data: planTrasReintento } = await supabase.from("planes").select("ciudad").eq("id", "plan-barrido-sello-viejo").single();
    const ciudadTrasReintento = planTrasReintento?.ciudad as CiudadEfectiva;
    expect(ciudadTrasReintento.intentado_en).not.toBe(intentadoEnViejo);
    expect(ciudadTrasReintento.version_resolutor).toBe(VERSION_RESOLUTOR_ACTUAL);

    // Si el reintento también hubiera salido "sin-ciudad-identificable",
    // ya vendría sellado con la versión vigente y el segundo tick no
    // gastaría ninguna petición más (bar-ac2 sobre el veredicto nuevo).
    if (ciudadTrasReintento.estado === "sin-ciudad-identificable") {
      const segundaFuente = fuenteInstrumentada(nominatim);
      await tick(supabase, {
        ejecutor: ejecutorQueFalla(),
        directorio: "/tmp",
        fuenteLugares: segundaFuente,
        fuenteFotos: FUENTE_FOTOS_SIN_RED,
        fuenteCercanos: FUENTE_CERCANOS_SIN_RED,
        esperaOciosaMs: 0,
        intervaloOciosoMs: 10,
      });
      expect(segundaFuente.consultadas).toHaveLength(0);
    }
  });

  it("bar-ac1: un plan con ciudad null la resuelve por su destino limpio (Sevilla) y a partir de ahí resuelve sus paradas", async () => {
    await sembrarPlan(supabase, "plan-barrido-ciudad-null", ["Real Alcázar", "Catedral de Sevilla", "Plaza de España", "Metropol Parasol", "Barrio de Santa Cruz"], {
      ciudad: null,
    });

    const nombreMuestra = ["Real Alcázar", "Catedral de Sevilla", "Plaza de España", "Metropol Parasol", "Barrio de Santa Cruz"];
    const fuente: FuenteLugares & FuenteCiudad = {
      async geocodificarDestino(destino: string) {
        return destino === DESTINO ? BBOX : null;
      },
      async buscarNominatim(nombre: string) {
        return nombreMuestra.includes(nombre) ? [candidato(nombre)] : [];
      },
      async buscarWikipedia() {
        return [];
      },
      async buscarLibre() {
        throw new Error("no debería deducir por paradas: el destino ya resuelve");
      },
      async geocodificarCiudad() {
        throw new Error("no debería geocodificar ciudad por separado: el destino ya resuelve");
      },
    };

    await tick(supabase, {
      ejecutor: ejecutorQueFalla(),
      directorio: "/tmp",
      fuenteLugares: fuente,
      fuenteFotos: FUENTE_FOTOS_SIN_RED,
      fuenteCercanos: FUENTE_CERCANOS_SIN_RED,
      esperaOciosaMs: 0,
      intervaloOciosoMs: 10,
    });

    const { data: plan } = await supabase.from("planes").select("ciudad").eq("id", "plan-barrido-ciudad-null").single();
    const ciudad = plan?.ciudad as CiudadEfectiva;
    expect(ciudad.estado).toBe("resuelta");
    expect(ciudad.metodo).toBe("destino");
    expect(ciudad.nombre).toBe(DESTINO);

    const { data: paradas } = await supabase.from("paradas").select("resolucion").in("nombre", nombreMuestra);
    for (const parada of paradas ?? []) {
      expect((parada.resolucion as { estado: string }).estado).toBe("resuelta");
    }
  });

  it("un fallo persistente en una parada concreta no tumba el tick ni deja el cerrojo cogido", async () => {
    await sembrarPlan(supabase, "plan-barrido-error", ["Parada Buena Uno", "Parada Rota", "Parada Buena Dos"], { ciudad: CIUDAD_RESUELTA });

    const fuente: FuenteLugares & FuenteCiudad = {
      async geocodificarDestino() {
        return BBOX;
      },
      async buscarNominatim(nombre: string) {
        if (nombre === "Parada Rota") throw new Error("429 persistente");
        return [candidato(nombre)];
      },
      async buscarWikipedia() {
        return [];
      },
      async buscarLibre() {
        return [];
      },
      async geocodificarCiudad() {
        return null;
      },
    };

    const resultado = await tick(supabase, {
      ejecutor: ejecutorQueFalla(),
      directorio: "/tmp",
      fuenteLugares: fuente,
      fuenteFotos: FUENTE_FOTOS_SIN_RED,
      fuenteCercanos: FUENTE_CERCANOS_SIN_RED,
      esperaOciosaMs: 0,
      intervaloOciosoMs: 10,
    });

    expect(resultado.cerrojoAdquirido).toBe(true);
    expect(resultado.trabajosProcesados).toBe(0);

    const { data: rota } = await supabase.from("paradas").select("resolucion").eq("nombre", "Parada Rota").single();
    expect((rota?.resolucion as { estado: string }).estado).toBe("error");

    const { data: buenas } = await supabase
      .from("paradas")
      .select("resolucion")
      .in("nombre", ["Parada Buena Uno", "Parada Buena Dos"]);
    for (const buena of buenas ?? []) {
      expect((buena.resolucion as { estado: string }).estado).toBe("resuelta");
    }

    // El cerrojo quedó liberado: un tick inmediato posterior puede volver a
    // adquirirlo.
    const liberado = await adquirirCerrojo(supabase, "comprobacion-cerrojo-libre");
    expect(liberado).toBe(true);
    await liberarCerrojo(supabase, "comprobacion-cerrojo-libre");
  });

  it("fot-ac4: completa fotos de paradas YA resueltas sin foto ni intento previo, dentro del mismo tope y sin tocar las que no son 'comida'", async () => {
    await sembrarPlan(supabase, "plan-barrido-fotos", ["Monumento Foto Uno", "Monumento Foto Dos"], { ciudad: CIUDAD_RESUELTA });

    // Simula paradas resueltas en una generación o barrido anterior
    // (lat/lon/lugar/resolucion ya puestos), pero a las que nunca les
    // tocó el paso de fotos -- exactamente el estado que fot-ac4 describe.
    const { data: filas } = await supabase.from("paradas").select("id, nombre").in("nombre", ["Monumento Foto Uno", "Monumento Foto Dos"]);
    for (const fila of filas ?? []) {
      await supabase
        .from("paradas")
        .update({ lat: 39.47, lon: -0.37, resolucion: { estado: "resuelta", intentado_en: new Date().toISOString() } })
        .eq("id", fila.id);
    }

    const llamadasGeosearch: Array<{ lat: number; lon: number }> = [];
    const FOTO_FIXTURE = {
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/x/x/Foto.jpg/640px-Foto.jpg",
      fichero: "Foto.jpg",
      autor: "Autor de prueba",
      licencia: "CC BY-SA 4.0",
      licencia_url: "https://creativecommons.org/licenses/by-sa/4.0",
      pagina_url: "https://commons.wikimedia.org/wiki/File:Foto.jpg",
      fuente: "commons" as const,
    };
    const fuenteFotosInstrumentada = crearFuenteFotosGrabada({
      // El geosearch solo devuelve lang+título; resolverFoto necesita
      // resumenPagina() para llegar del título al nombre de fichero antes
      // de pedir infoImagen() -sin esta entrada, intentarPagina() se para
      // en 'sin fichero' y la foto nunca llega aunque geosearch acierte-.
      paginas: { "es:Página con foto": { fichero: "Foto.jpg" } },
      imagenes: { "Foto.jpg": FOTO_FIXTURE },
      geosearch: { "39.47,-0.37": [{ lang: "es", titulo: "Página con foto" }] },
    });
    const geosearchOriginal = fuenteFotosInstrumentada.geosearch.bind(fuenteFotosInstrumentada);
    let llamadaNumero = 0;
    fuenteFotosInstrumentada.geosearch = async (lat: number, lon: number) => {
      llamadasGeosearch.push({ lat, lon });
      llamadaNumero++;
      // La primera parada "encuentra" foto; la segunda no tiene página con
      // imagen -- dos resultados distintos con la misma fuente instrumentada.
      if (llamadaNumero === 1) return geosearchOriginal(lat, lon);
      return [];
    };

    const resultado = await tick(supabase, {
      ejecutor: ejecutorQueFalla(),
      directorio: "/tmp",
      fuenteLugares: fuenteInstrumentada({}),
      fuenteFotos: fuenteFotosInstrumentada,
      fuenteCercanos: FUENTE_CERCANOS_SIN_RED,
      esperaOciosaMs: 0,
      intervaloOciosoMs: 10,
    });

    expect(resultado.cerrojoAdquirido).toBe(true);
    expect(llamadasGeosearch).toHaveLength(2);

    const { data: paradasFinal } = await supabase
      .from("paradas")
      .select("nombre, foto, foto_intentada_en")
      .in("nombre", ["Monumento Foto Uno", "Monumento Foto Dos"])
      .order("nombre", { ascending: true });
    expect(paradasFinal).toHaveLength(2);
    for (const parada of paradasFinal ?? []) {
      expect(parada.foto_intentada_en).not.toBeNull();
    }
    const conFoto = (paradasFinal ?? []).filter((p) => p.foto !== null);
    const sinFoto = (paradasFinal ?? []).filter((p) => p.foto === null);
    expect(conFoto).toHaveLength(1);
    expect(sinFoto).toHaveLength(1);
  });
});

// cc-ac3 (cp-cc-03): las paradas guardadas con el consejo cortado se vuelven
// a pedir una sola vez, y solo las de la última versión de cada plan.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("reformateo de la guía (cc-ac3)", () => {
  const supabase = clienteDePrueba();
  const PLAN = "plan-barrido-guia-formato";
  const NOMBRES = ["Museo Alfa Antiguo", "Palacio Beta Real", "Castillo Gamma Viejo", "Torre Delta Sola"];
  const frase = "Una frase completa del consejo que mide cincuenta caracteres.";
  const consejoLargo = Array.from({ length: 16 }, () => frase).join(" ").slice(0, 1000);

  beforeEach(async () => {
    await supabase.from("planes").delete().like("id", "plan-barrido-guia-%");
  });

  async function sembrar(): Promise<void> {
    await supabase.from("planes").insert({ id: PLAN, destino: DESTINO, ciudad: CIUDAD_RESUELTA });
    const { data: procedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
    const franjas = [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }];
    const ids: string[] = [];
    for (const version of [1, 2]) {
      const { data } = await supabase
        .from("plan_versiones")
        .insert({ plan_id: PLAN, version, personas: 2, dias: [{ fecha: "2026-11-01", franjas }], avisos: [] })
        .select("id")
        .single();
      ids.push(data?.id as string);
    }
    const cortado = { consejo: `${consejoLargo.slice(0, 399)}…`, url: "https://es.wikivoyage.org/wiki/Viejo", licencia: "CC BY-SA" };
    const resuelta = { estado: "resuelta", intentado_en: "2026-10-01T00:00:00Z" };
    const filas = NOMBRES.map((nombre, i) => ({
      plan_version_id: i === 3 ? ids[0] : ids[1],
      id_externo: `g-${i}`,
      dia_index: 0,
      franja_id: "manana",
      nombre,
      descripcion: "",
      duracion_min: 60,
      prioridad: 50,
      procedencia_id: procedencia?.id,
      lat: 39.47 + i * 0.01,
      lon: -0.37,
      resolucion: resuelta,
      foto_intentada_en: "2026-10-01T00:00:00Z",
      guia: cortado,
      guia_intentada_en: "2026-10-02T00:00:00Z",
    }));
    const { error } = await supabase.from("paradas").insert(filas);
    if (error) throw new Error(`No se pudo sembrar: ${error.message}`);
  }

  it("cp-cc-03: reformatea las de la última versión una vez; la de la versión anterior queda intacta; ficha desaparecida → guia null y no se repite", async () => {
    await sembrar();
    const llamadas: string[] = [];
    // La fuente solo tiene fichas de las dos primeras: «Castillo Gamma Viejo» ya no la tiene.
    const fichas: FichaGuia[] = NOMBRES.slice(0, 2).map((nombre) => ({ tipo: "see", nombre, contenido: consejoLargo }));
    const fuenteGuia: FuenteGuia = {
      async paginaCiudad(ciudad) {
        llamadas.push(ciudad);
        return { idioma: "es", titulo: ciudad, url: "https://es.wikivoyage.org/wiki/Valencia", fichas };
      },
    };
    const correr = () => completarParadasPendientes(supabase, fuenteInstrumentada({}), 120, FUENTE_FOTOS_SIN_RED, undefined, undefined, FUENTE_CERCANOS_SIN_RED, undefined, fuenteGuia);

    await correr();
    const { data } = await supabase.from("paradas").select("nombre, guia, guia_formato").in("nombre", NOMBRES);
    const por = new Map((data ?? []).map((f) => [f.nombre as string, f]));
    for (const nombre of NOMBRES.slice(0, 2)) {
      expect(por.get(nombre)?.guia_formato).toBe(FORMATO_GUIA);
      const consejo = (por.get(nombre)?.guia as { consejo: string }).consejo;
      expect(consejo).toBe(consejoLargo);
      expect(consejo.endsWith("…")).toBe(false);
    }
    // Sin ficha en la fuente: queda sin guía, ya formateada.
    expect(por.get("Castillo Gamma Viejo")?.guia).toBeNull();
    expect(por.get("Castillo Gamma Viejo")?.guia_formato).toBe(FORMATO_GUIA);
    // Versión anterior: intacta.
    expect(por.get("Torre Delta Sola")?.guia_formato).toBeNull();
    expect((por.get("Torre Delta Sola")?.guia as { consejo: string }).consejo).toHaveLength(400);

    const antes = llamadas.length;
    await correr();
    expect(llamadas.length).toBe(antes);
  });
});

// alg-ac3 (cp-alg-03): las alternativas pendientes se rellenan en el mismo
// lote que sus paradas, con UNA sola página de Wikivoyage por ciudad.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("guía de las alternativas (alg-ac3)", () => {
  const supabase = clienteDePrueba();
  const PLAN = "plan-barrido-guia-alt";
  const PARADAS = ["Museo Alfa Uno", "Palacio Beta Dos", "Castillo Gamma Tres", "Torre Delta Cuatro"];
  // Nombres sin parecido entre sí (la asignación de fichas usa similitud de
  // nombre): las 5 primeras tendrán ficha en la fuente, las 7 siguientes no.
  const CON_FICHA = ["Observatorio Marítimo", "Jardín Botánico", "Biblioteca Municipal", "Mercado Central", "Estación del Norte"];
  const SIN_FICHA = ["Plaza Redonda", "Faro Viejo", "Puente Romano", "Acuario Grande", "Teatro Principal", "Ermita Alta", "Bodega Antigua"];

  beforeEach(async () => {
    await supabase.from("planes").delete().like("id", "plan-barrido-guia-%");
  });

  async function sembrar(): Promise<void> {
    await supabase.from("planes").insert({ id: PLAN, destino: DESTINO, ciudad: CIUDAD_RESUELTA });
    const { data: procedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
    const franjas = [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }];
    const { data: version } = await supabase
      .from("plan_versiones")
      .insert({ plan_id: PLAN, version: 1, personas: 2, dias: [{ fecha: "2026-11-01", franjas }], avisos: [] })
      .select("id")
      .single();
    const resuelta = { estado: "resuelta", intentado_en: "2026-10-01T00:00:00Z" };
    const { data: paradas, error } = await supabase
      .from("paradas")
      .insert(
        PARADAS.map((nombre, i) => ({
          plan_version_id: version?.id,
          id_externo: `ga-${i}`,
          dia_index: 0,
          franja_id: "manana",
          nombre,
          descripcion: "",
          duracion_min: 60,
          prioridad: 50,
          procedencia_id: procedencia?.id,
          lat: 39.47 + i * 0.01,
          lon: -0.37,
          resolucion: resuelta,
          foto_intentada_en: "2026-10-01T00:00:00Z",
        })),
      )
      .select("id");
    if (error || !paradas) throw new Error(`No se pudo sembrar: ${error?.message}`);
    const nombresAlternativas = [...CON_FICHA, ...SIN_FICHA];
    const alternativas = paradas.flatMap((parada, i) =>
      [0, 1, 2].map((j) => ({
        parada_id: parada.id,
        origen: "modelo",
        nombre: nombresAlternativas[i * 3 + j],
        descripcion: "d",
        motivo: "m",
        duracion_min: 60,
        categoria: "monumento",
        lat: 39.3 + i * 0.01 + j * 0.001,
        lon: -0.2,
        // Una alternativa sin lugar: se marca intentada igualmente.
        lugar: null,
      })),
    );
    const { error: errorAlt } = await supabase.from("paradas_alternativas").insert(alternativas);
    if (errorAlt) throw new Error(`No se pudieron sembrar las alternativas: ${errorAlt.message}`);
  }

  it("cp-alg-03: 1 sola página de ciudad; las 12 alternativas y las 4 paradas quedan intentadas; solo las que tienen ficha llevan consejo", async () => {
    await sembrar();
    let llamadas = 0;
    const fichas: FichaGuia[] = [
      { tipo: "see", nombre: "Museo Alfa Uno", contenido: "Consejo de la parada Alfa." },
      { tipo: "see", nombre: "Palacio Beta Dos", contenido: "Consejo de la parada Beta." },
      ...CON_FICHA.map((nombre): FichaGuia => ({ tipo: "see", nombre, contenido: `Consejo de ${nombre}.` })),
    ];
    const fuenteGuia: FuenteGuia = {
      async paginaCiudad(ciudad) {
        llamadas += 1;
        return { idioma: "es", titulo: ciudad, url: "https://es.wikivoyage.org/wiki/Valencia", fichas };
      },
    };
    await completarParadasPendientes(supabase, fuenteInstrumentada({}), 120, FUENTE_FOTOS_SIN_RED, undefined, undefined, FUENTE_CERCANOS_SIN_RED, undefined, fuenteGuia);

    expect(llamadas).toBe(1);
    const { data: paradas } = await supabase.from("paradas").select("nombre, guia, guia_intentada_en, guia_formato").in("nombre", PARADAS);
    expect(paradas).toHaveLength(4);
    for (const fila of paradas ?? []) {
      expect(fila.guia_intentada_en).not.toBeNull();
      expect(fila.guia_formato).toBe(FORMATO_GUIA);
    }
    const conFicha = (paradas ?? []).filter((f) => f.guia !== null).map((f) => f.nombre);
    expect(conFicha.sort()).toEqual(["Museo Alfa Uno", "Palacio Beta Dos"]);

    const { data: idsParadas } = await supabase.from("paradas").select("id").in("nombre", PARADAS);
    const { data: alternativas } = await supabase
      .from("paradas_alternativas")
      .select("nombre, guia, guia_intentada_en, guia_formato")
      .in("parada_id", (idsParadas ?? []).map((f) => f.id as string));
    expect(alternativas).toHaveLength(12);
    for (const fila of alternativas ?? []) {
      expect(fila.guia_intentada_en).not.toBeNull();
      expect(fila.guia_formato).toBe(FORMATO_GUIA);
    }
    const conConsejo = (alternativas ?? []).filter((f) => (f.guia as { consejo?: string } | null)?.consejo);
    expect(conConsejo.map((f) => f.nombre).sort()).toEqual([...CON_FICHA].sort());

    // Ya intentadas: otro tick no vuelve a pedir nada.
    const antes = llamadas;
    await completarParadasPendientes(supabase, fuenteInstrumentada({}), 120, FUENTE_FOTOS_SIN_RED, undefined, undefined, FUENTE_CERCANOS_SIN_RED, undefined, fuenteGuia);
    expect(llamadas).toBe(antes);
  });
});

// cp-cur-04: el relleno es de una sola invocación por versión, el respaldo
// tiene una única mejora con el modelo y lo ya elegido no se vuelve a pedir.
describe.skipIf(!SUPABASE_URL || !SERVICE_KEY)("curiosidades verificadas en el plan (cp-cur-04)", () => {
  const supabase = clienteDePrueba();
  const PLAN = "plan-curiosidades-cur04";
  let versionId = "";

  beforeEach(async () => {
    await supabase.from("planes").delete().like("id", "plan-curiosidades-%");
    await supabase.from("planes").insert({ id: PLAN, destino: "Londres-cur04" });
    const { data: procedencia } = await supabase.from("procedencias").insert({ fuente: "propuesto-sin-verificar" }).select("id").single();
    const franjas = [{ id: "manana", etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" }];
    const { data: version } = await supabase
      .from("plan_versiones")
      .insert({ plan_id: PLAN, version: 1, personas: 2, dias: [{ fecha: "2026-11-01", franjas }], avisos: [] })
      .select("id")
      .single();
    versionId = version?.id as string;
    const sitios = sitiosLondres();
    const paradasLondres = sitios.filter((s) => s.tipo === "parada");
    const alternativasLondres = sitios.filter((s) => s.tipo === "alternativa");
    const { data: paradas, error } = await supabase
      .from("paradas")
      .insert(
        paradasLondres.map((s, i) => ({
          plan_version_id: versionId,
          id_externo: `cur-${i}`,
          dia_index: 0,
          franja_id: "manana",
          nombre: s.nombre,
          descripcion: "",
          duracion_min: 60,
          prioridad: 50,
          procedencia_id: procedencia?.id,
          lat: 51.5 + i * 0.01,
          lon: -0.12,
          lugar: s.lugar,
          resolucion: { estado: "resuelta", intentado_en: "2026-10-01T00:00:00Z" },
          guia_formato: FORMATO_GUIA,
        })),
      )
      .select("id");
    if (error || !paradas) throw new Error(`No se pudo sembrar: ${error?.message}`);
    const { error: errorAlt } = await supabase.from("paradas_alternativas").insert(
      paradas.flatMap((parada, i) =>
        alternativasLondres.map((s, j) => ({
          parada_id: parada.id,
          origen: "modelo",
          nombre: `${s.nombre} ${i}${j}`,
          descripcion: "d",
          motivo: "m",
          duracion_min: 60,
          categoria: "museo",
          lat: 51.4 + i * 0.01 + j * 0.001,
          lon: -0.12,
          lugar: s.lugar,
          guia_formato: FORMATO_GUIA,
        })),
      ),
    );
    if (errorAlt) throw new Error(`No se pudieron sembrar las alternativas: ${errorAlt.message}`);
  });

  function ejecutorContador(modo: "limite" | "modelo") {
    let invocaciones = 0;
    const ejecutor: EjecutorModelo = {
      async invocar(prompt) {
        invocaciones += 1;
        if (modo === "limite") throw new LimiteDeUsoAlcanzado("2026-10-06T10:00:00Z", 100);
        const claves = [...prompt.matchAll(/^(s\d+) — /gm)].map((m) => m[1]);
        return { texto: JSON.stringify(Object.fromEntries(claves.map((k) => [k, ["c1", "c2"]]))) };
      },
    };
    return { ejecutor, invocaciones: () => invocaciones };
  }

  async function leer() {
    const { data: paradas } = await supabase.from("paradas").select("id, curiosidades").eq("plan_version_id", versionId);
    const { data: alternativas } = await supabase
      .from("paradas_alternativas")
      .select("id, curiosidades")
      .in("parada_id", (paradas ?? []).map((p) => p.id as string));
    return [...(paradas ?? []), ...(alternativas ?? [])] as Array<{ id: string; curiosidades: { items: unknown[]; seleccion: string; mejora_intentada: boolean } | null }>;
  }

  it("límite de uso: 12 sitios con respaldo; un segundo tick los mejora con 1 invocación; el tercero no invoca", async () => {
    const dependencias = (e: EjecutorModelo) => ({ fuente: fuenteGrabada(), ejecutor: e, directorio: process.cwd() });
    const versiones = [{ id: versionId, ciudad: null }];

    const sinCupo = ejecutorContador("limite");
    const r1 = await rellenarCuriosidadesPendientes(supabase, dependencias(sinCupo.ejecutor), versiones);
    expect(r1.invocaciones).toBe(1);
    expect(sinCupo.invocaciones()).toBe(1);
    const tras1 = await leer();
    expect(tras1).toHaveLength(12);
    for (const f of tras1) {
      expect(f.curiosidades?.seleccion).toBe("heuristica");
      expect(f.curiosidades?.items.length).toBeGreaterThan(0);
    }

    const conCupo = ejecutorContador("modelo");
    const r2 = await rellenarCuriosidadesPendientes(supabase, dependencias(conCupo.ejecutor), versiones);
    expect(r2.invocaciones).toBe(1);
    expect(conCupo.invocaciones()).toBe(1);
    const tras2 = await leer();
    expect(tras2).toHaveLength(12);
    for (const f of tras2) expect(f.curiosidades?.seleccion).toBe("modelo");

    const otro = ejecutorContador("modelo");
    const r3 = await rellenarCuriosidadesPendientes(supabase, dependencias(otro.ejecutor), versiones);
    expect(r3.invocaciones).toBe(0);
    expect(otro.invocaciones()).toBe(0);
    expect(await leer()).toEqual(tras2);
  });

  it("una fuente caída pospone la versión sin tocar nada", async () => {
    const fuente = fuenteGrabada();
    const { FalloFuenteCuriosidades } = await import("@/lib/guia/fuenteCuriosidades");
    fuente.entidades = async () => {
      throw new FalloFuenteCuriosidades("Wikidata caída");
    };
    const { ejecutor, invocaciones } = ejecutorContador("modelo");
    const r = await rellenarCuriosidadesPendientes(supabase, { fuente, ejecutor, directorio: process.cwd() }, [{ id: versionId, ciudad: null }]);
    expect(r.pospuestas).toBeGreaterThan(0);
    expect(invocaciones()).toBe(0);
    for (const f of await leer()) expect(f.curiosidades).toBeNull();
  });
});
