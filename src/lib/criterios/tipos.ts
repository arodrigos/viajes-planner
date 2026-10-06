// Entrada del usuario: destino/tipo, fechas o época, días, personas con
// edad, perfil de viaje y presupuesto. El alojamiento es SIEMPRE opcional
// (decisión de producto): en el flujo normal no se pide, la zona la propone
// la herramienta (bloque alojamiento-propuesto). Solo existe como campo
// avanzado por si el usuario ya ha reservado.
export type Perfil = "familiar" | "amigos" | "pareja" | "solo";

export type Fechas = { modo: "fechas"; inicio: string; fin: string } | { modo: "epoca"; epoca: string };

// Medios entre ciudades. Lista cerrada: es también la lista blanca del
// esquema, así que un valor nuevo se añade aquí y se propaga solo.
export const MODOS_TRANSPORTE = ["coche", "avion", "tren", "autobus"] as const;
export type Modo = (typeof MODOS_TRANSPORTE)[number];

export interface CriteriosViaje {
  destino_o_tipo: string;
  fechas: Fechas;
  dias: number;
  personas: { edad: number }[];
  perfil: Perfil;
  presupuesto_eur: number;
  alojamiento?: { direccion: string };
  // bloque generacion: el único parámetro numérico del sistema. Por
  // defecto lo deriva el perfil (ver src/lib/generacion/tope.ts) porque no
  // existe señal de datos abiertos que signifique "apto para familias";
  // esto permite al usuario sobrescribirlo explícitamente.
  tope_sitios_por_franja?: number;
  // Ausente = cualquier medio. Solo pesa si el destino es un país, una región
  // o varios países; en una ciudad suelta no hay traslados que elegir.
  transporte?: Modo[];
}
