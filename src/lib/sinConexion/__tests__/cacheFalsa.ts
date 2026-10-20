// Cache API mínima en memoria (jsdom no la trae): lo que se prueba es qué se
// guarda y qué se busca, no el navegador. Las claves son URL en texto.
export function falsaCacheStorage(inicial: Record<string, Record<string, string>> = {}) {
  const almacen = new Map<string, Map<string, Response>>(
    Object.entries(inicial).map(([n, e]) => [n, new Map(Object.entries(e).map(([u, c]) => [u, new Response(c)]))]),
  );
  const url = (r: RequestInfo | URL): string => (typeof r === "string" ? r : r instanceof URL ? r.href : r.url);
  const abrir = (n: string) => {
    if (!almacen.has(n)) almacen.set(n, new Map());
    const m = almacen.get(n)!;
    return {
      match: async (r: RequestInfo | URL) => m.get(url(r))?.clone(),
      put: async (r: RequestInfo | URL, resp: Response) => void m.set(url(r), resp.clone()),
      delete: async (r: RequestInfo | URL) => m.delete(url(r)),
      keys: async () => [...m.keys()].map((u) => new Request(u)),
    };
  };
  return {
    almacen,
    has: async (n: string) => almacen.has(n),
    delete: async (n: string) => almacen.delete(n),
    open: async (n: string) => abrir(n),
  };
}
