// Lista blanca de correos: el mecanismo que mantiene el encuadre personal
// confirmado como decisión de producto y que impide que el RGPD entre por descuido. Una
// lista vacía no es "nadie autorizado todavía", es una configuración rota:
// el arranque debe fallar en vez de dejar pasar a cualquiera por omisión.
const VARIABLE = "CORREOS_PERMITIDOS";

export class ConfiguracionCorreosPermitidosVacia extends Error {
  constructor() {
    super(`La variable de entorno ${VARIABLE} está vacía o no definida`);
    this.name = "ConfiguracionCorreosPermitidosVacia";
  }
}

export function correosPermitidos(valor: string | undefined = process.env[VARIABLE]): string[] {
  const lista = (valor ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length > 0);
  if (lista.length === 0) throw new ConfiguracionCorreosPermitidosVacia();
  return lista;
}

export function correoPermitido(correo: string, valor?: string): boolean {
  return correosPermitidos(valor).includes(correo.trim().toLowerCase());
}
