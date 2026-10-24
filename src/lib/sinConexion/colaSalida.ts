import { openDB, type DBSchema, type IDBPDatabase } from "idb";

// Cola de salida genérica (solo cliente): lo que el usuario hace sin red se
// guarda aquí y se reproduce al volver. No usa Background Sync porque iPhone no
// lo tiene: la sincronización la disparan quienes la usan (evento online, vuelta
// a primer plano, apertura de la pestaña y tras cada alta). Entrega "al menos
// una vez": el servidor tiene que ser idempotente (id generado en el cliente).
export interface OperacionCola {
  clave: string; // p. ej. 'gasto:<uuid>': una sola operación pendiente por clave
  ambito: string; // plan_id: lo que se vacía al cerrar sesión o eliminar el viaje
  tipo: "guardar" | "borrar";
  url: string;
  cuerpo?: unknown;
  creada: string;
  intentos: number;
  estado: "pendiente" | "sin-sesion" | "rechazada";
  error?: string;
  // Contador monotónico: distingue una operación de su reemplazo mientras la
  // primera está en vuelo, aunque compartan clave y milisegundo.
  rev: number;
}

export type NuevaOperacion = Pick<OperacionCola, "clave" | "ambito" | "tipo" | "url" | "cuerpo">;

export interface EspejoLeido<T> {
  datos: T[];
  guardadoEn: string;
}

export interface ColaSalida {
  encolar(op: NuevaOperacion): Promise<void>;
  pendientes(ambito: string): Promise<OperacionCola[]>;
  sincronizar(): Promise<{ subidas: number; pendientes: number }>;
  descartar(clave: string): Promise<void>;
  vaciarAmbito(ambito: string): Promise<void>;
  vaciarTodo(): Promise<void>;
  leerEspejo<T extends { id: string }>(ambito: string): Promise<EspejoLeido<T> | null>;
  guardarEspejo(ambito: string, datos: { id: string }[]): Promise<void>;
  alCambiar(cb: () => void): () => void;
}

interface RegistroEspejo {
  k: string;
  ambito: string;
  meta?: true;
  guardadoEn?: string;
  dato?: { id: string };
}

interface Esquema extends DBSchema {
  operaciones: { key: string; value: OperacionCola; indexes: { ambito: string } };
  espejo: { key: string; value: RegistroEspejo; indexes: { ambito: string } };
}

// Almacén mínimo: IndexedDB en el navegador y memoria si no existe o falla
// (modo privado de algunos navegadores). En memoria la cola se pierde al
// recargar, pero la pantalla sigue funcionando.
interface Almacen {
  operaciones(): Promise<OperacionCola[]>;
  operacion(clave: string): Promise<OperacionCola | undefined>;
  poner(op: OperacionCola): Promise<void>;
  quitar(clave: string): Promise<void>;
  quitarAmbito(ambito: string): Promise<void>;
  quitarTodo(): Promise<void>;
  espejo(ambito: string): Promise<RegistroEspejo[]>;
  reemplazarEspejo(ambito: string, registros: RegistroEspejo[]): Promise<void>;
}

function almacenEnMemoria(): Almacen {
  const ops = new Map<string, OperacionCola>();
  const espejos = new Map<string, RegistroEspejo[]>();
  return {
    operaciones: async () => [...ops.values()],
    operacion: async (clave) => ops.get(clave),
    poner: async (op) => void ops.set(op.clave, op),
    quitar: async (clave) => void ops.delete(clave),
    quitarAmbito: async (ambito) => {
      for (const [k, op] of ops) if (op.ambito === ambito) ops.delete(k);
      espejos.delete(ambito);
    },
    quitarTodo: async () => {
      ops.clear();
      espejos.clear();
    },
    espejo: async (ambito) => espejos.get(ambito) ?? [],
    reemplazarEspejo: async (ambito, registros) => void espejos.set(ambito, registros),
  };
}

function almacenIdb(abrir: () => Promise<IDBPDatabase<Esquema>>): Almacen {
  return {
    operaciones: async () => (await abrir()).getAll("operaciones"),
    operacion: async (clave) => (await abrir()).get("operaciones", clave),
    poner: async (op) => void (await (await abrir()).put("operaciones", op)),
    quitar: async (clave) => (await abrir()).delete("operaciones", clave),
    quitarAmbito: async (ambito) => {
      const tx = (await abrir()).transaction(["operaciones", "espejo"], "readwrite");
      for (const nombre of ["operaciones", "espejo"] as const) {
        const claves = await tx.objectStore(nombre).index("ambito").getAllKeys(ambito);
        await Promise.all(claves.map((k) => tx.objectStore(nombre).delete(k)));
      }
      await tx.done;
    },
    quitarTodo: async () => {
      const tx = (await abrir()).transaction(["operaciones", "espejo"], "readwrite");
      await Promise.all([tx.objectStore("operaciones").clear(), tx.objectStore("espejo").clear()]);
      await tx.done;
    },
    espejo: async (ambito) => (await abrir()).getAllFromIndex("espejo", "ambito", ambito),
    reemplazarEspejo: async (ambito, registros) => {
      const tx = (await abrir()).transaction("espejo", "readwrite");
      const claves = await tx.store.index("ambito").getAllKeys(ambito);
      await Promise.all(claves.map((k) => tx.store.delete(k)));
      await Promise.all(registros.map((r) => tx.store.put(r)));
      await tx.done;
    },
  };
}

// 1, 2, 4… hasta 60 s: lo usa quien programa el reintento tras un fallo de red.
export function esperaMs(intentos: number): number {
  return Math.min(60, 2 ** Math.max(0, intentos - 1)) * 1000;
}

async function motivo(respuesta: Response): Promise<string | undefined> {
  try {
    const cuerpo = (await respuesta.json()) as { error?: unknown };
    return typeof cuerpo.error === "string" ? cuerpo.error : undefined;
  } catch {
    return undefined;
  }
}

let ultimaRev = 0;
const siguienteRev = () => (ultimaRev = Math.max(ultimaRev + 1, Date.now()));

export function crearColaSalida(nombre: string): ColaSalida {
  let almacen: Almacen | null = null;
  const escuchas = new Set<() => void>();
  const avisar = () => escuchas.forEach((cb) => cb());

  async function obtener(): Promise<Almacen> {
    if (almacen) return almacen;
    if (typeof indexedDB === "undefined") return (almacen = almacenEnMemoria());
    try {
      const db = await openDB<Esquema>(nombre, 1, {
        upgrade(base) {
          base.createObjectStore("operaciones", { keyPath: "clave" }).createIndex("ambito", "ambito");
          base.createObjectStore("espejo", { keyPath: "k" }).createIndex("ambito", "ambito");
        },
      });
      almacen = almacenIdb(async () => db);
    } catch {
      almacen = almacenEnMemoria();
    }
    return almacen;
  }

  const porOrden = (a: OperacionCola, b: OperacionCola) => a.rev - b.rev;

  let enCurso: Promise<{ subidas: number; pendientes: number }> | null = null;
  let repetir = false;

  async function pasada(): Promise<{ subidas: number; pendientes: number }> {
    const a = await obtener();
    let subidas = 0;
    const todas = (await a.operaciones()).sort(porOrden);
    for (let i = 0; i < todas.length; i++) {
      const op = todas[i];
      if (op.estado === "rechazada") continue;
      let respuesta: Response | null = null;
      try {
        respuesta = await fetch(op.url, {
          method: op.tipo === "borrar" ? "DELETE" : "PUT",
          headers: op.cuerpo === undefined ? undefined : { "content-type": "application/json" },
          body: op.cuerpo === undefined ? undefined : JSON.stringify(op.cuerpo),
        });
      } catch {
        respuesta = null;
      }
      // Si mientras volaba la petición se encoló un reemplazo con la misma
      // clave, lo que hay guardado ya no es esta operación: no se toca.
      const actual = await a.operacion(op.clave);
      if (!actual || actual.rev !== op.rev) {
        // Alguien reemplazó la operación (o la descartó) en vuelo: si sigue
        // habiendo una, hay que subirla en otra pasada.
        if (actual) repetir = true;
        continue;
      }
      if (respuesta && (respuesta.ok || (respuesta.status === 404 && op.tipo === "borrar"))) {
        await a.quitar(op.clave);
        subidas++;
      } else if (respuesta?.status === 401) {
        // Sin sesión no hay nada más que probar: todo lo que queda espera al acceso.
        for (const resto of todas.slice(i)) {
          const vigente = await a.operacion(resto.clave);
          if (vigente && vigente.rev === resto.rev && vigente.estado !== "rechazada") await a.poner({ ...vigente, estado: "sin-sesion" });
        }
        break;
      } else if (respuesta && respuesta.status >= 400 && respuesta.status < 500) {
        await a.poner({ ...actual, estado: "rechazada", intentos: actual.intentos + 1, error: await motivo(respuesta) });
      } else {
        await a.poner({ ...actual, estado: "pendiente", intentos: actual.intentos + 1 });
      }
    }
    const pendientes = (await a.operaciones()).filter((o) => o.estado !== "rechazada").length;
    return { subidas, pendientes };
  }

  return {
    async encolar(op) {
      const a = await obtener();
      await a.poner({ ...op, creada: new Date().toISOString(), intentos: 0, estado: "pendiente", rev: siguienteRev() });
      avisar();
    },
    async pendientes(ambito) {
      return (await (await obtener()).operaciones()).filter((o) => o.ambito === ambito).sort(porOrden);
    },
    // Una sola pasada a la vez; si piden otra mientras corre, se repite al
    // acabar para no dejar fuera lo que se encoló entretanto.
    sincronizar() {
      if (enCurso) {
        repetir = true;
        return enCurso;
      }
      enCurso = (async () => {
        let total = { subidas: 0, pendientes: 0 };
        try {
          do {
            repetir = false;
            const r = await pasada();
            total = { subidas: total.subidas + r.subidas, pendientes: r.pendientes };
            avisar();
          } while (repetir);
        } finally {
          enCurso = null;
        }
        return total;
      })();
      return enCurso;
    },
    async descartar(clave) {
      await (await obtener()).quitar(clave);
      avisar();
    },
    async vaciarAmbito(ambito) {
      await (await obtener()).quitarAmbito(ambito);
      avisar();
    },
    async vaciarTodo() {
      await (await obtener()).quitarTodo();
      avisar();
    },
    async leerEspejo<T extends { id: string }>(ambito: string) {
      const registros = await (await obtener()).espejo(ambito);
      const meta = registros.find((r) => r.meta);
      if (!meta?.guardadoEn) return null;
      return { datos: registros.filter((r) => r.dato).map((r) => r.dato as T), guardadoEn: meta.guardadoEn };
    },
    async guardarEspejo(ambito, datos) {
      const registros: RegistroEspejo[] = [
        { k: `${ambito}:`, ambito, meta: true, guardadoEn: new Date().toISOString() },
        ...datos.map((dato) => ({ k: `${ambito}:${dato.id}`, ambito, dato })),
      ];
      await (await obtener()).reemplazarEspejo(ambito, registros);
    },
    alCambiar(cb) {
      escuchas.add(cb);
      return () => void escuchas.delete(cb);
    },
  };
}
