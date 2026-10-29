// Los manejadores ya no son `route.ts` (los llama un despachador), así que el
// RouteContext generado por Next no los conoce; este tipo da lo mismo desde el patrón.
type Parametros<S extends string> = S extends `${string}[${infer P}]${infer Resto}` ? P | Parametros<Resto> : never;

export type ContextoRuta<R extends string> = { params: Promise<{ [K in Parametros<R>]: string }> };
