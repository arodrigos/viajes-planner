// Entrada del usuario: destino/tipo, fechas o época, días, personas con
// edad, perfil de viaje y presupuesto. El alojamiento es SIEMPRE opcional
// (respuesta de Adrián): en el flujo normal no se pide, la zona la propone
// la herramienta (bloque alojamiento-propuesto). Solo existe como campo
// avanzado por si el usuario ya ha reservado.
export type Perfil = "familiar" | "amigos" | "pareja" | "solo";

export type Fechas = { modo: "fechas"; inicio: string; fin: string } | { modo: "epoca"; epoca: string };

export interface CriteriosViaje {
  destino_o_tipo: string;
  fechas: Fechas;
  dias: number;
  personas: { edad: number }[];
  perfil: Perfil;
  presupuesto_eur: number;
  alojamiento?: { direccion: string };
}
