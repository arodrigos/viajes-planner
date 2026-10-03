// lug-ac3: un solo hilo contra Nominatim, con >= 1.100 ms entre peticiones
// consecutivas y nunca dos en vuelo. El reloj es inyectable para que el
// test de ritmo use temporizadores falsos en vez de esperar de verdad.
export interface Reloj {
  ahora(): number;
  dormir(ms: number): Promise<void>;
}

export const relojReal: Reloj = {
  ahora: () => Date.now(),
  dormir: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export type Limitador = <T>(tarea: () => Promise<T>) => Promise<T>;

export function crearLimitador(intervaloMinMs: number, reloj: Reloj = relojReal): Limitador {
  let ultimaLlamada = -Infinity;
  // Encadenar sobre la promesa anterior es lo que serializa: una tarea no
  // empieza su espera hasta que la anterior ha registrado su propia marca
  // de tiempo, así que nunca hay dos peticiones en vuelo a la vez.
  let colaSerializada: Promise<void> = Promise.resolve();

  return async function limitar<T>(tarea: () => Promise<T>): Promise<T> {
    const miTurno = colaSerializada.then(async () => {
      const espera = Math.max(0, ultimaLlamada + intervaloMinMs - reloj.ahora());
      if (espera > 0) await reloj.dormir(espera);
      ultimaLlamada = reloj.ahora();
    });
    colaSerializada = miTurno;
    await miTurno;
    return tarea();
  };
}
