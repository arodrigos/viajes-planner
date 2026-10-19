"use client";

import { useEffect } from "react";

const PREFIJOS_PROPIOS = ["viajes-", "serwist-"];

// Interruptor de emergencia (NEXT_PUBLIC_SW_DESACTIVADO=1): el siguiente
// despliegue desregistra el SW en cada dispositivo que abra la app y vacía
// lo que dejó, en vez de dejar un worker defectuoso persistiendo.
export async function desactivarServiceWorker(): Promise<void> {
  const registros = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registros.map((r) => r.unregister()));
  if (typeof caches === "undefined") return;
  const nombres = await caches.keys();
  await Promise.all(nombres.filter((n) => PREFIJOS_PROPIOS.some((p) => n.startsWith(p))).map((n) => caches.delete(n)));
}

export default function RegistroSinConexion() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Un fallo de registro nunca rompe la app: sigue funcionando sin copia.
    if (process.env.NEXT_PUBLIC_SW_DESACTIVADO === "1") {
      void desactivarServiceWorker().catch(() => undefined);
      return;
    }
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
  }, []);
  return null;
}
