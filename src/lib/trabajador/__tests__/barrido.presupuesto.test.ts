import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { completarParadasPendientes } from "@/lib/trabajador/barrido";
import { crearPresupuestoTick, presupuestoAnidado, PRESUPUESTO_PETICIONES_POR_TICK } from "@/lib/trabajador/presupuestoTick";
import type { FuenteCercanos } from "@/lib/alternativas/cercanos";
import type { CajaDelimitadora, FuenteCiudad, FuenteFotos, FuenteLugares } from "@/lib/lugares/tipos";
import type { Reloj } from "@/lib/lugares/limitador";

// Un tick del barrido con dobles que cuentan cada llamada a una fuente
// externa. Sin red y sin Supabase: la base es un doble en memoria que solo
// entiende las consultas que hace completarParadasPendientes.

type Fila = Record<string, unknown>;

function valorDe(fila: Fila, columna: string): unknown {
  const [raiz, clave] = columna.split("->>");
  const valor = fila[raiz];
  if (clave === undefined) return valor;
  return valor && typeof valor === "object" ? (valor as Record<string, unknown>)[clave] : undefined;
}

function crearBaseEnMemoria(tablas: Record<string, Fila[]>) {
  let siguienteId = 0;
  function consulta(tabla: string) {
    const filtros: Array<(fila: Fila) => boolean> = [];
    let tope = Infinity;
    let orden: { columna: string; ascendente: boolean } | null = null;
    let operacion: { tipo: "select" } | { tipo: "update"; valores: Fila } = { tipo: "select" };
    const filas = () => (tablas[tabla] ??= []);
    const constructor = {
      select: () => constructor,
      update(valores: Fila) {
        operacion = { tipo: "update", valores };
        return constructor;
      },
      insert(fila: Fila) {
        filas().push({ id: `nuevo-${siguienteId++}`, ...fila });
        return Promise.resolve({ error: null });
      },
      order(columna: string, opciones?: { ascending?: boolean }) {
        orden = { columna, ascendente: opciones?.ascending ?? true };
        return constructor;
      },
      eq(columna: string, valor: unknown) {
        filtros.push((fila) => valorDe(fila, columna) === valor);
        return constructor;
      },
      in(columna: string, valores: unknown[]) {
        filtros.push((fila) => valores.includes(valorDe(fila, columna)));
        return constructor;
      },
      is(columna: string, valor: null) {
        filtros.push((fila) => (valorDe(fila, columna) ?? null) === valor);
        return constructor;
      },
      lt(columna: string, valor: string) {
        filtros.push((fila) => {
          const actual = valorDe(fila, columna);
          return typeof actual === "string" && actual < valor;
        });
        return constructor;
      },
      limit(n: number) {
        tope = n;
        return constructor;
      },
      then<R>(resolver: (r: { data: Fila[] | null; error: null }) => R) {
        const elegidas = filas().filter((fila) => filtros.every((f) => f(fila)));
        if (operacion.tipo === "update") {
          for (const fila of elegidas) Object.assign(fila, operacion.valores);
          return Promise.resolve(resolver({ data: null, error: null }));
        }
        if (orden) {
          const { columna, ascendente } = orden;
          elegidas.sort((a, b) => (Number(a[columna]) - Number(b[columna])) * (ascendente ? 1 : -1));
        }
        const datos = elegidas.slice(0, tope).map((fila) =>
          tabla === "plan_versiones" ? { ...fila, planes: tablas.planes.find((p) => p.id === fila.plan_id) ?? null } : { ...fila },
        );
        return Promise.resolve(resolver({ data: datos, error: null }));
      },
    };
    return constructor;
  }
  return { cliente: { from: consulta }, tablas };
}

const CAJA: CajaDelimitadora = { minLat: 40.3, maxLat: 40.5, minLon: -3.8, maxLon: -3.6 };

function crearDobles() {
  const llamadas = { total: 0 };
  const contar = () => {
    llamadas.total++;
  };
  // Nada casa ni tiene foto: cada fase llega a su coste máximo por elemento.
  const fuenteLugares: FuenteLugares & FuenteCiudad = {
    geocodificarDestino: async () => (contar(), null),
    buscarNominatim: async () => (contar(), []),
    buscarWikipedia: async () => (contar(), []),
    buscarLibre: async () => (contar(), []),
    geocodificarCiudad: async () => (contar(), null),
  };
  const fuenteFotos: FuenteFotos = {
    resumenPagina: async () => (contar(), null),
    infoImagen: async () => (contar(), null),
    geosearch: async () => (contar(), [1, 2, 3, 4, 5].map((i) => ({ lang: "es", titulo: `Página ${i}` }))),
  };
  let cercano = 0;
  const fuenteCercanos: FuenteCercanos = {
    buscar: async (_categoria, lat, lon) => {
      contar();
      return [1, 2, 3].map(() => {
        cercano++;
        return { id: `osm:node/${cercano}`, nombre: `Cercano ${cercano}`, lat: lat + 0.001 * (cercano % 7 + 1), lon };
      });
    },
  };
  return { llamadas, fuenteLugares, fuenteFotos, fuenteCercanos };
}

// Planes sin ciudad (cada uno puede gastar el tope por plan deduciéndola),
// paradas pendientes de ubicar y paradas ya ubicadas sin foto ni
// alternativas, y paradas anteriores al corte de la pasada única.
function escenario(opciones: { planesSinCiudad: number; pendientes: number; resueltas: number; antiguas: number }) {
  const planes: Fila[] = [
    { id: "plan-ok", destino: "Madrid", ciudad: { estado: "resuelta", nombre: "Madrid", caja: CAJA, intentado_en: "2026-10-01T00:00:00Z" } },
  ];
  const versiones: Fila[] = [{ id: "v-ok", plan_id: "plan-ok", version: 1, dias: [{ fecha: "2026-11-01" }], etapas: null }];
  const paradas: Fila[] = [];
  const parada = (id: string, version: string, extra: Fila): Fila => ({
    id,
    nombre: `Sitio ${id}`,
    categoria: "monumento",
    dia_index: 0,
    plan_version_id: version,
    resolucion: null,
    lat: null,
    lon: null,
    lugar: null,
    duracion_min: 60,
    alternativas_intentadas_en: null,
    foto: null,
    foto_intentada_en: null,
    ...extra,
  });
  const ubicada = {
    resolucion: { estado: "resuelta", intentado_en: "2026-10-01T00:00:00Z" },
    lat: 40.4,
    lon: -3.7,
    lugar: { fuente: "wikipedia", id: "wikipedia:es:X", url: "https://es.wikipedia.org/wiki/X", nombre_fuente: "X", etiquetas: {}, resuelto_en: "2026-10-01T00:00:00Z" },
  };
  for (let i = 0; i < opciones.planesSinCiudad; i++) {
    planes.push({ id: `plan-${i}`, destino: `Escapada ${i} en familia`, ciudad: null });
    versiones.push({ id: `v-${i}`, plan_id: `plan-${i}`, version: 1, dias: [{ fecha: "2026-11-01" }], etapas: null });
    for (let j = 0; j < 4; j++) paradas.push(parada(`c${i}-${j}`, `v-${i}`, {}));
  }
  for (let i = 0; i < opciones.pendientes; i++) paradas.push(parada(`p${i}`, "v-ok", {}));
  for (let i = 0; i < opciones.resueltas; i++) paradas.push(parada(`r${i}`, "v-ok", ubicada));
  for (let i = 0; i < opciones.antiguas; i++) {
    paradas.push(parada(`a${i}`, "v-ok", { ...ubicada, foto_intentada_en: "2026-10-01T00:00:00Z", alternativas_intentadas_en: "2026-10-01T00:00:00Z" }));
  }
  return crearBaseEnMemoria({ planes, plan_versiones: versiones, paradas, paradas_alternativas: [] });
}

const relojParado: Reloj = { ahora: () => 0, dormir: async () => {} };
const CORTE = new Date("2026-10-05T18:00:00Z");

async function correrTick(base: ReturnType<typeof escenario>, presupuestoPeticiones?: number) {
  const dobles = crearDobles();
  const resultado = await completarParadasPendientes(
    base.cliente as never,
    dobles.fuenteLugares,
    120,
    dobles.fuenteFotos,
    relojParado,
    180_000,
    dobles.fuenteCercanos,
    CORTE,
    undefined,
    undefined,
    undefined,
    presupuestoPeticiones,
  );
  return { resultado, llamadas: dobles.llamadas.total };
}

const GRANDE = { planesSinCiudad: 20, pendientes: 200, resueltas: 200, antiguas: 200 };

describe("presupuesto único de peticiones externas por tick", () => {
  it("sin cupo compartido (cada fase con su propio tope, como antes) un tick pasa con mucho de 120 peticiones", async () => {
    const { llamadas } = await correrTick(escenario(GRANDE), Infinity);
    // Ciudad (hasta 20 planes x 12) + ubicación (120 x 2) + fotos (120 x 7) +
    // alternativas y pasada única (120 x 19 cada una).
    expect(llamadas).toBeGreaterThan(10 * PRESUPUESTO_PETICIONES_POR_TICK);
  });

  it("con el cupo por defecto, todas las fases juntas no pasan de 120 peticiones y el resultado las cuenta todas", async () => {
    const { resultado, llamadas } = await correrTick(escenario(GRANDE));
    expect(llamadas).toBeLessThanOrEqual(PRESUPUESTO_PETICIONES_POR_TICK);
    expect(resultado.peticionesExternas).toBe(llamadas);
    // Veinte planes sin ciudad no se comen el tick entero: las ciudades
    // solo pueden gastar la mitad y el resto ubica paradas.
    expect(resultado.peticionesNominatimCiudad).toBeLessThanOrEqual(PRESUPUESTO_PETICIONES_POR_TICK / 2);
    expect(resultado.paradasIntentadas).toBeGreaterThan(0);
  });

  it("para cualquier cupo y cualquier mezcla de trabajo, nunca se supera el cupo ni la carga sin cupo compartido", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 200 }),
        fc.record({
          planesSinCiudad: fc.integer({ min: 0, max: 4 }),
          pendientes: fc.integer({ min: 0, max: 30 }),
          resueltas: fc.integer({ min: 0, max: 6 }),
          antiguas: fc.integer({ min: 0, max: 6 }),
        }),
        async (cupo, mezcla) => {
          const conCupo = await correrTick(escenario(mezcla), cupo);
          const sinCupo = await correrTick(escenario(mezcla), Infinity);
          expect(conCupo.llamadas).toBeLessThanOrEqual(cupo);
          expect(conCupo.llamadas).toBeLessThanOrEqual(sinCupo.llamadas);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("quedarse sin cupo no gasta intentos: ninguna parada queda marcada sin haberse intentado entera", async () => {
    for (const cupo of [0, 1, 7, 30, 79, 100]) {
      const base = escenario({ planesSinCiudad: 0, pendientes: 0, resueltas: 3, antiguas: 0 });
      await correrTick(base, cupo);
      const paradas = base.tablas.paradas;
      const alternativas = base.tablas.paradas_alternativas;
      for (const fila of paradas) {
        const suyas = alternativas.filter((a) => a.parada_id === fila.id).length;
        // Tres cercanos y marca, o nada y sin marca: nunca a medias.
        expect([0, 3]).toContain(suyas);
        expect(fila.alternativas_intentadas_en !== null).toBe(suyas === 3);
      }
      // Cada foto completa cuesta 7 peticiones con estos dobles (resumen propio,
      // geosearch y cinco resúmenes de cercanía).
      const fotosMarcadas = paradas.filter((fila) => fila.foto_intentada_en !== null).length;
      expect(fotosMarcadas).toBe(Math.min(3, Math.floor(cupo / 7)));
    }
  });

  it("el tope por plan de la ciudad sigue valiendo dentro del cupo del tick", () => {
    const tick = crearPresupuestoTick(20);
    const plan = presupuestoAnidado(tick, 12);
    let concedidas = 0;
    while (plan.consumir()) concedidas++;
    expect(concedidas).toBe(12);
    expect(tick.restantes()).toBe(8);
    const otro = presupuestoAnidado(tick, 12);
    let otras = 0;
    while (otro.consumir()) otras++;
    expect(otras).toBe(8);
    expect(tick.restantes()).toBe(0);
  });
});
