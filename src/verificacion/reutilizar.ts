// Resuelve qué plan usa la suite preview, reutilizando antes de crear: generar
// uno multiciudad cuesta ~38 min de trabajador, más de lo que cabe en una
// pasada de juicio de 60 min. La lógica va aquí, separada del navegador, para
// poder probarla con un contexto de peticiones doblado.

export interface Respuesta {
  ok(): boolean;
  status(): number;
  json(): Promise<unknown>;
}
export interface Peticiones {
  get(ruta: string): Promise<Respuesta>;
}

export const MIN_ETAPAS = 2;
export const MIN_PARADAS_UBICADAS = 0.5;
// Lo que exigen pv-cur-03 y pv-trabajador (cp-cur-04, cp-alg-03).
export const MIN_RELLENO = 0.5;
export const EDAD_MAXIMA_DIAS = 7;
const ESTADOS_EN_VUELO = ["encolado", "en-curso", "pausado-por-cuota"];
const DIA_MS = 86_400_000;

type ParadaApi = {
  coordenadas?: unknown;
  procedencia?: { fuente?: string };
  alternativas?: unknown[];
  curiosidades?: { items?: unknown[] };
};
type PlanApi = { etapas?: unknown[]; dias?: Array<{ paradas?: ParadaApi[] }> };

export type Veredicto = { util: true } | { util: false; fase: "estructura" | "relleno"; motivo: string };

// Separa lo que no se arregla esperando (sin etapas, sin ubicar) de lo que sí
// (el barrido del trabajador rellena guía y curiosidades en los ticks
// posteriores a «completado»).
export function evaluarPlan(plan: PlanApi): Veredicto {
  const paradas = (plan.dias ?? []).flatMap((d) => d.paradas ?? []);
  const etapas = plan.etapas?.length ?? 0;
  if (etapas < MIN_ETAPAS) return { util: false, fase: "estructura", motivo: `el plan generado tiene ${etapas} etapas y hacen falta ${MIN_ETAPAS}` };
  const ubicadas = paradas.filter((p) => p.coordenadas).length;
  if (paradas.length === 0 || ubicadas / paradas.length < MIN_PARADAS_UBICADAS) {
    return { util: false, fase: "estructura", motivo: `solo ${ubicadas} de ${paradas.length} paradas ubicadas: el plan no sirve para juzgar los casos` };
  }
  const comprobadas = paradas.filter((p) => p.procedencia?.fuente && p.procedencia.fuente !== "propuesto-sin-verificar");
  const conCuriosidades = comprobadas.filter((p) => (p.curiosidades?.items?.length ?? 0) > 0).length;
  const conAlternativas = comprobadas.filter((p) => (p.alternativas?.length ?? 0) > 0).length;
  if (comprobadas.length === 0 || conCuriosidades / comprobadas.length < MIN_RELLENO || conAlternativas / comprobadas.length < MIN_RELLENO) {
    return { util: false, fase: "relleno", motivo: `el plan aún no tiene guía y curiosidades (${conCuriosidades} con curiosidades y ${conAlternativas} con alternativas de ${comprobadas.length} comprobadas)` };
  }
  return { util: true };
}

async function leerPlan(peticiones: Peticiones, planId: string): Promise<{ plan: PlanApi } | { estado: number }> {
  const r = await peticiones.get(`/api/plan/${planId}`);
  return r.ok() ? { plan: (await r.json()) as PlanApi } : { estado: r.status() };
}

export type Viaje = { id: string; destino: string; estado: string; plan_id: string | null; fecha_inicio: string | null };
type Trabajo = { estado: string; plan_id?: string | null };

export interface Dependencias {
  peticiones: Peticiones;
  destino: string;
  diasDeAntelacion: number;
  // Crea el trabajo por el formulario real y devuelve su id.
  crearTrabajo: () => Promise<string>;
  ahora: () => number;
  dormir: (ms: number) => Promise<void>;
  esperaMaximaMs: number;
  sondeoMs: number;
  entorno: Record<string, string | undefined>;
  // Contenido de plan.json de una pasada anterior, si existe.
  guardado: { id?: string; trabajoId?: string } | undefined;
  guardarTrabajo: (trabajoId: string) => void;
}

export type Resultado = { planId: string; trabajoId?: string; creado: boolean } | { encolado: string };

// El plan lo creó la suite el día de inicio menos la antelación: el listado de
// viajes no trae fecha de creación y esta es la que más se le parece.
function edadEstimadaDias(viaje: Viaje, d: Dependencias): number | undefined {
  if (!viaje.fecha_inicio) return undefined;
  const creado = Date.parse(viaje.fecha_inicio) - d.diasDeAntelacion * DIA_MS;
  return (d.ahora() - creado) / DIA_MS;
}

async function veredictoDe(d: Dependencias, planId: string): Promise<Veredicto | undefined> {
  const leido = await leerPlan(d.peticiones, planId);
  return "plan" in leido ? evaluarPlan(leido.plan) : undefined;
}

// Sondea un trabajo ya existente hasta que complete y su plan tenga el relleno
// del barrido; un fallo estructural del plan es definitivo y corta en el acto.
async function esperarTrabajo(d: Dependencias, trabajoId: string): Promise<string> {
  const limite = d.ahora() + d.esperaMaximaMs;
  let ultimoRelleno: string | undefined;
  for (;;) {
    const r = await d.peticiones.get(`/api/trabajos/${trabajoId}`);
    if (r.ok()) {
      const trabajo = (await r.json()) as Trabajo;
      if (["fallido", "caducado"].includes(trabajo.estado)) throw new Error(`El trabajo de generación terminó en estado ${trabajo.estado}`);
      if (trabajo.estado === "completado" && trabajo.plan_id) {
        const leido = await leerPlan(d.peticiones, trabajo.plan_id);
        if ("estado" in leido) throw new Error(`pv-setup: no se pudo leer el plan generado (HTTP ${leido.estado})`);
        const veredicto = evaluarPlan(leido.plan);
        if (veredicto.util) return trabajo.plan_id;
        if (veredicto.fase === "estructura") throw new Error(`pv-setup: ${veredicto.motivo}`);
        ultimoRelleno = veredicto.motivo;
      }
    }
    if (d.ahora() >= limite) {
      throw new Error(ultimoRelleno ? `pv-setup: ${ultimoRelleno}` : "el trabajador no ha generado el plan a tiempo");
    }
    await d.dormir(d.sondeoMs);
  }
}

// Orden: PLAN_PRUEBA_ID, plan.json, plan útil reciente del usuario, trabajo en
// curso del usuario y, solo si no hay nada, un trabajo nuevo.
export async function resolverPlan(d: Dependencias): Promise<Resultado> {
  if (d.entorno.PLAN_PRUEBA_ID) {
    const leido = await leerPlan(d.peticiones, d.entorno.PLAN_PRUEBA_ID);
    if ("estado" in leido) throw new Error(`PLAN_PRUEBA_ID no es un plan visible para el usuario de pruebas (HTTP ${leido.estado})`);
    return { planId: d.entorno.PLAN_PRUEBA_ID, creado: false };
  }

  if (d.guardado?.id && (await veredictoDe(d, d.guardado.id))?.util) return { planId: d.guardado.id, creado: false };

  const lista = await d.peticiones.get("/api/viajes");
  const viajes = lista.ok() ? (((await lista.json()) as { viajes?: Viaje[] }).viajes ?? []) : [];
  const delDestino = viajes.filter((v) => v.destino.trim().toLowerCase() === d.destino.toLowerCase());

  // /api/viajes ya viene del más reciente al más antiguo.
  // Un plan reciente al que solo le falta el relleno del barrido no se
  // descarta: se espera a ese mismo trabajo en vez de generar otro.
  let sinRellenar: string | undefined;
  for (const v of delDestino.filter((x) => x.estado === "completado" && x.plan_id)) {
    const edad = edadEstimadaDias(v, d);
    if (edad === undefined || edad > EDAD_MAXIMA_DIAS) continue;
    const veredicto = await veredictoDe(d, v.plan_id!);
    if (veredicto?.util) return { planId: v.plan_id!, trabajoId: v.id, creado: false };
    if (veredicto && !veredicto.util && veredicto.fase === "relleno") sinRellenar ??= v.id;
  }

  // plan.json solo con trabajoId es el aviso de una pasada que encoló y salió.
  const reanudable = d.guardado?.id ? undefined : d.guardado?.trabajoId;
  const enCurso = reanudable ?? sinRellenar ?? delDestino.find((v) => ESTADOS_EN_VUELO.includes(v.estado))?.id;
  const trabajoId = enCurso ?? (await d.crearTrabajo());
  d.guardarTrabajo(trabajoId);
  if (d.entorno.VERIFICACION_SOLO_ENCOLAR === "1") return { encolado: trabajoId };

  const planId = await esperarTrabajo(d, trabajoId);
  return { planId, trabajoId, creado: !enCurso };
}

// El plan se conserva salvo orden expresa: regenerarlo cuesta ~38 min.
export function limpiezaDePlan(creado: boolean, entorno: Record<string, string | undefined>, borrar: () => Promise<void>): (() => Promise<void>) | undefined {
  return creado && entorno.VERIFICACION_BORRAR === "1" ? borrar : undefined;
}
