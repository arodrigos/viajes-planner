// dest-ac2/dest-ac3: "hoy" es la fecha del DISPOSITIVO, no UTC -- por eso
// se usan los getters locales de Date (getFullYear/getMonth/getDate) en vez
// de su equivalente UTC. Vive aparte de VistaPlan.tsx para poder fijar la
// fecha del sistema en los tests sin montar el componente entero.
export function fechaDeHoy(): string {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = String(hoy.getMonth() + 1).padStart(2, "0");
  const dia = String(hoy.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

export function esFechaDeHoy(fechaISO: string): boolean {
  return fechaISO === fechaDeHoy();
}
