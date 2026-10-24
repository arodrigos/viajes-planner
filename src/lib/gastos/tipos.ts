export const CATEGORIAS_GASTO = ["comida", "entradas", "transporte", "alojamiento"] as const;
export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number];

export interface Gasto {
  id: string;
  importe_centimos: number;
  // null = «Todo el viaje». Obligatorio null en alojamiento y obligatorio no
  // null en comida y entradas.
  fecha: string | null;
  categoria: CategoriaGasto;
  concepto?: string;
  actualizado_cliente: string;
}

// Lo que va en el cuerpo del PUT: todo menos el id, que va en la URL.
export type GastoEntrada = Omit<Gasto, "id">;

export const TOPE_GASTOS = 500;
export const IMPORTE_MAX_CENTIMOS = 10_000_000;
export const LONGITUD_CONCEPTO = 80;
