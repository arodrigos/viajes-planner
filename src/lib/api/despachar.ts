import { NextRequest, NextResponse } from "next/server";

// Despachador de rutas de API: Vercel empaqueta cada route.ts como una función
// aparte (con el runtime de Next dentro, decenas de MB), así que las rutas se
// agrupan en pocos route.ts que reparten a los manejadores de siempre. El
// despachador no mira sesión ni permisos: eso sigue dentro de cada manejador.
const METODOS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;
export type Metodo = (typeof METODOS)[number];

type Manejador = (request: NextRequest, ctx: never) => Response | Promise<Response>;
type Modulo = Partial<Record<Metodo, Manejador>>;
export type Tabla = ReadonlyArray<{ patron: string; modulo: () => Promise<Modulo> }>;

// Devuelve los parámetros si la ruta casa con el patrón ("/api/plan/[id]/gastos"), o null.
export function casar(patron: string, pathname: string): Record<string, string> | null {
  const p = patron.split("/");
  const r = pathname.split("/");
  if (p.length !== r.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const m = /^\[(\w+)\]$/.exec(p[i]);
    if (m) {
      if (r[i] === "") return null;
      try {
        params[m[1]] = decodeURIComponent(r[i]);
      } catch {
        return null;
      }
    } else if (p[i] !== r[i]) return null;
  }
  return params;
}

export async function despachar(tabla: Tabla, request: NextRequest, metodo: Metodo): Promise<Response> {
  const pathname = request.nextUrl.pathname;
  for (const { patron, modulo } of tabla) {
    const params = casar(patron, pathname);
    if (!params) continue;
    const mod = await modulo();
    const manejador = mod[metodo];
    if (manejador) return manejador(request, { params: Promise.resolve(params) } as never);
    // Igual que Next con un route.ts que no exporta el método.
    const permitidos = METODOS.filter((m) => mod[m]).join(", ");
    return new NextResponse(null, { status: 405, headers: { Allow: permitidos } });
  }
  return new NextResponse(null, { status: 404 });
}

// Los route.ts exportan estas cinco funciones; cada una delega en la tabla.
export function exportarMetodos(tabla: Tabla) {
  const delegar = (metodo: Metodo) => (request: NextRequest) => despachar(tabla, request, metodo);
  return { GET: delegar("GET"), POST: delegar("POST"), PATCH: delegar("PATCH"), PUT: delegar("PUT"), DELETE: delegar("DELETE") };
}
