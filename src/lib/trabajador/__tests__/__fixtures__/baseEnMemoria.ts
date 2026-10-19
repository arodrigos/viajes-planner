// Doble de Supabase en memoria que solo entiende las consultas que hace
// completarParadasPendientes. Mismo contenido que el de barrido.presupuesto.test.ts:
// se duplica en vez de tocar ese fichero para no mover tests ya aprobados.

export type Fila = Record<string, unknown>;

function valorDe(fila: Fila, columna: string): unknown {
  const [raiz, clave] = columna.split("->>");
  const valor = fila[raiz];
  if (clave === undefined) return valor;
  return valor && typeof valor === "object" ? (valor as Record<string, unknown>)[clave] : undefined;
}

export function crearBaseEnMemoria(tablas: Record<string, Fila[]>) {
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
