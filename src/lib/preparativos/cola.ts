import { crearColaSalida, type ColaSalida } from "@/lib/sinConexion/colaSalida";

// Base IndexedDB propia: el espejo es por plan y el de gastos también lo es,
// así que compartir base haría que cada uno pisara el del otro.
let cola: ColaSalida | null = null;
export const colaPreparativos = (): ColaSalida => (cola ??= crearColaSalida("viajes-preparativos"));
