import { crearColaSalida, type ColaSalida } from "@/lib/sinConexion/colaSalida";

// Una sola cola por pestaña, creada la primera vez que se usa: así importar el
// módulo en servidor o en una prueba no abre IndexedDB.
let cola: ColaSalida | null = null;
export const colaDeSalida = (): ColaSalida => (cola ??= crearColaSalida("viajes-cola"));
