# Viajes por país

## Medios entre paradas del mismo día

Entre dos paradas resueltas consecutivas del mismo día, el plan propone un medio, un tiempo y un enlace de Google Maps. Son **estimaciones por distancia, no por rutas reales**: no se consulta ninguna API de rutas.

- Distancia: línea recta entre las dos paradas × 1,3 (factor calle/línea recta), redondeada a 0,1 km.
- A pie hasta **1,5 km** con perfil familiar y hasta **2,0 km** con cualquier otro perfil (el límite es inclusivo).
- Más allá: transporte público o taxi (`travelmode=transit`), o coche (`travelmode=driving`) si el viaje solo admite coche (`transporte = ['coche']`).
- Minutos, siempre múltiplos de 5 hacia arriba: a pie 4 km/h; transporte 10 min de espera + 18,5 km/h; coche 5 min + 25 km/h.
- La línea «A pie» del día suma solo los tramos a pie; los de transporte salen aparte como «En transporte». El aviso de «mucho paseo» mira solo lo andado.
- El enlace del recorrido completo del día solo fuerza `travelmode=walking` si todos los tramos son a pie.

Código: `src/lib/plan/tramos.ts`.
