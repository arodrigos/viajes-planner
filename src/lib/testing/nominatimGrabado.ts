import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crearFuenteAbierta } from "@/lib/lugares/fuenteAbierta";
import { cacheSitiosMemoria } from "@/lib/lugares/cacheSitios";
import type { FuenteCiudad, FuenteLugares } from "@/lib/lugares/tipos";

// Respuestas REALES de Nominatim (fixtures/lugares/zonas.json, grabadas el
// 2026-10-05 con la misma URL que construye geocodificarZona), indexadas por
// el texto `q`. Se sirven desde un `fetch` falso que cuenta las peticiones:
// así el test recorre el código real de fuenteAbierta (URL, parseo, caché),
// no un doble que se salta justo lo que hay que comprobar.
const RUTA = join(process.cwd(), "fixtures", "lugares", "zonas.json");
const RESPUESTAS: Record<string, unknown[]> = JSON.parse(readFileSync(RUTA, "utf8"));

export function fuenteZonasGrabada(opciones: { sinRed?: boolean } = {}): {
  fuente: FuenteLugares & FuenteCiudad;
  peticiones: string[];
} {
  const peticiones: string[] = [];
  const fetchGrabado = (async (entrada: string | URL | Request) => {
    const q = new URL(String(entrada)).searchParams.get("q") ?? "";
    peticiones.push(q);
    if (opciones.sinRed) throw new Error("sin red (simulado)");
    return new Response(JSON.stringify(RESPUESTAS[q] ?? []), { status: 200 });
  }) as typeof fetch;
  const fuente = crearFuenteAbierta({
    fetch: fetchGrabado,
    cache: cacheSitiosMemoria(),
    intervaloMinMs: 0,
    reloj: { ahora: () => 0, dormir: async () => undefined },
  });
  return { fuente, peticiones };
}
