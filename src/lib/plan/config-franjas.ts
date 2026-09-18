// Único sitio del código donde vive un límite horario de franja. La comida
// no ocurre a la misma hora en Sevilla que en Estocolmo (esquema-plan-ac3):
// por eso esto es configuración por destino con un valor por defecto, y el
// resto del proyecto no debe declarar ninguna hora suelta.

export interface DefinicionFranja {
  etiqueta: string;
  hora_inicio: string;
  hora_fin: string;
}

export type ConfigFranjas = Record<string, DefinicionFranja>;

export const FRANJAS_POR_DEFECTO: ConfigFranjas = {
  "manana-temprano": { etiqueta: "Mañana temprano", hora_inicio: "07:00", hora_fin: "09:00" },
  manana: { etiqueta: "Mañana", hora_inicio: "09:00", hora_fin: "13:00" },
  comida: { etiqueta: "Comida", hora_inicio: "13:00", hora_fin: "15:30" },
  tarde: { etiqueta: "Tarde", hora_inicio: "15:30", hora_fin: "19:00" },
  cena: { etiqueta: "Cena", hora_inicio: "19:00", hora_fin: "21:30" },
  noche: { etiqueta: "Noche", hora_inicio: "21:30", hora_fin: "23:30" },
};

// Solapes conocidos frente al valor por defecto. No hace falta declarar las
// seis franjas: franjasParaDestino combina esto con FRANJAS_POR_DEFECTO.
export const SOLAPES_POR_DESTINO: Record<string, Partial<ConfigFranjas>> = {
  estocolmo: {
    comida: { etiqueta: "Comida", hora_inicio: "11:30", hora_fin: "13:30" },
    cena: { etiqueta: "Cena", hora_inicio: "17:30", hora_fin: "19:30" },
  },
  sevilla: {
    comida: { etiqueta: "Comida", hora_inicio: "14:00", hora_fin: "16:30" },
    cena: { etiqueta: "Cena", hora_inicio: "21:00", hora_fin: "23:00" },
  },
};

export function franjasParaDestino(destino: string): ConfigFranjas {
  const clave = destino.trim().toLowerCase();
  const solape = SOLAPES_POR_DESTINO[clave] ?? {};
  const resultado: ConfigFranjas = { ...FRANJAS_POR_DEFECTO };
  for (const id of Object.keys(solape) as (keyof ConfigFranjas)[]) {
    const definicion = solape[id];
    if (definicion) resultado[id] = definicion;
  }
  return resultado;
}
