# Relleno de planes

Qué significa que un plan esté "relleno" de verdad (sus paradas resueltas
contra una fuente real, su ciudad identificada), cómo se mide ese estado
agregado en producción y qué hacer cuando la deducción automática de la
ciudad no llega. Lo exige el diseño del bloque `salud-del-relleno` y lo
amplía `ciudad-a-mano`.

## Qué mide /api/salud.relleno

El campo `relleno` de `GET /api/salud` es un objeto de solo números,
calculado con consultas de recuento exacto (sin traer ninguna fila de
contenido) y cacheado 60 s en memoria del proceso para que un endpoint
público y sin autenticar no se convierta en un amplificador de carga:

- `paradas_total`, `paradas_resueltas`, `paradas_no_resueltas`,
  `paradas_en_error`, `paradas_sin_intentar`: el estado de
  `resolucion.estado` de cada parada, agregado sobre TODAS las paradas de
  la base (no por plan). `paradas_total` siempre es la suma exacta de las
  otras cuatro.
- `paradas_con_foto`, `paradas_con_alternativas`: cuántas paradas tienen
  foto o al menos una alternativa guardada.
- `paradas_con_categoria`: cuántas paradas tienen `categoria`. Sin ella la
  pasada de alternativas no consulta Overpass; el barrido la deduce del
  nombre y de la clasificación OSM del lugar (`alternativas/categorizar.ts`).
- `planes_total`, `planes_con_version`, `planes_con_trabajo_vivo`: cuántos
  planes existen, cuántos ya tienen al menos una versión generada y
  cuántos tienen un trabajo propietario sin marcar `eliminado_en`.
- `planes_con_ciudad`, `planes_sin_ciudad_identificable`: cuántos planes
  tienen `ciudad.estado = 'resuelta'` o `'pendiente-manual'` frente a
  cuántos están en `'sin-ciudad-identificable'` -- el primer indicio público
  de que el bloque `ciudad-a-mano` hace falta de verdad en DEV.

Estos números no distinguen entre "recién sembrado" y "el barrido lleva
ya varios ticks": eso lo juzga quien lee dos capturas de `/api/salud`
separadas en el tiempo, nunca una lectura aislada.

## Cuándo un plan queda sin ciudad identificable

`resolverCiudadEfectiva` (`src/lib/lugares/ciudad.ts`) intenta primero la
caja del destino tal como lo escribió quien pidió el viaje; si esa caja no
resuelve suficientes paradas o abarca una zona demasiado grande, prueba
hasta 3 nombres de ciudad extraídos del propio texto del destino (quitando
colas conocidas como "en familia con niños" o tomando los primeros tokens),
cada uno validado contra la misma muestra de paradas; y si ninguno de esos
candidatos verifica, cae a deducir la ciudad por voto de consenso entre las
paradas ya nombradas. El plan queda en `ciudad.estado =
'sin-ciudad-identificable'` cuando ninguna de las tres vías llega a un
resultado claro -- casos reales: un destino genérico como "Ciudad con
niños" (sin nombre de ciudad en absoluto) o un destino con paradas
repartidas entre varias ciudades candidatas sin que ninguna tenga ventaja
clara. El motivo exacto (el recuento de candidatos, o por qué se descartó
la caja del destino) queda en `ciudad.motivo` y es lo que la vista del plan
muestra tal cual, nunca reinterpretado.

No hay reintento automático de la deducción: es determinista, así que
repetirla con las mismas paradas vuelve a fallar igual. La única salida es
que alguien diga la ciudad a mano.

## Cómo decir la ciudad a mano

En la vista del plan (`VistaPlan.tsx`, componente `AvisoCiudad.tsx`), un
plan `sin-ciudad-identificable` muestra el aviso, el motivo, un campo
"¿De qué ciudad es este viaje?" y el botón "Guardar ciudad". Al guardar:

1. `POST /api/plan/[id]/ciudad` comprueba sesión y propiedad del plan
   (mismo criterio 404 que el resto de endpoints de `/api/plan/[id]`:
   ajeno, inexistente y con el trabajo eliminado responden igual) y acepta
   como mucho un envío por hora y por plan.
2. Si se acepta, escribe ÚNICAMENTE `planes.ciudad = {estado:
   'pendiente-manual', nombre_pedido, pedido_en}` -- recortado a 80
   caracteres, nunca una llamada a Nominatim desde aquí.
3. El trabajador (`barrido.ts`/`resolverPuertaDeCiudad`) geocodifica
   `nombre_pedido` en su siguiente tick: si existe, la ciudad pasa a
   `resuelta` con `metodo: 'manual'` y las paradas empiezan a ubicarse en
   los ticks siguientes; si no, vuelve a `sin-ciudad-identificable` con el
   motivo «No hemos encontrado "X" en el mapa: comprueba el nombre» y el
   campo sigue disponible para otro intento.

Mientras la ciudad está `pendiente-manual`, la vista no vuelve a pedirla:
dice que la búsqueda está en marcha. El contador «N de M sitios ubicados»
se muestra siempre que el plan tiene alguna parada, resuelta la ciudad o
no -- es el único indicio visible de que el barrido sigue trabajando
durante los primeros minutos.
