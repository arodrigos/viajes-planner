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
- `paradas_con_motivo`, `versiones_multiciudad`, `trabajos_inviables`:
  paradas con `motivo` no vacío, versiones con `etapas` no vacío (viaje de
  varias ciudades) y trabajos con `inviable` no nulo. Son recuentos de solo
  cabecera, como el resto.
- `curiosidades_formato_antiguo`: paradas y alternativas de la última versión
  de cada plan que tienen curiosidades guardadas con un formato anterior a
  `FORMATO_CURIOSIDADES`. Es lo que el trabajador aún tiene que rehacer (una
  versión por tick); baja hasta 0 sin pasos manuales. Entero agregado.
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

Las siete siguientes salen de otra función, `estado_relleno_motivos()`, para
no cambiar la salida de `estado_relleno()`; si esa función falla o aún no
existe, `relleno` se publica sin ellas.

- `paradas_no_resueltas_sin_candidatos`, `_fuera_de_caja`,
  `_nombre_distinto`, `_tipo_incompatible` y `_motivo_desconocido`: por qué
  quedan paradas en `no-resuelta`, según `resolucion.categoria_motivo`. Es
  la fase más avanzada de la regla de aceptación (`lugares/aceptacion.ts`) a
  la que llegó algún candidato de Nominatim o de Wikipedia: sin candidatos,
  todos fuera de la caja, ninguno con un nombre parecido, o con nombre pero
  de un tipo incompatible con la categoría. `_motivo_desconocido` son las
  guardadas antes de existir la categoría; bajan solas cuando el barrido
  las reintenta. Las cinco suman `paradas_no_resueltas`.
- `paradas_con_toponimo`: el total menos las no-resueltas por
  `sin-candidatos` o `nombre-distinto` (nada en la caja se llama así: casi
  siempre una frase de actividad, no un sitio). Es el denominador para medir
  cuántas paradas con nombre de sitio están ubicadas
  (`paradas_resueltas / paradas_con_toponimo`). Aproximado: un sitio real
  mal escrito también se descuenta, y las de motivo desconocido aún cuentan.
- `paradas_sin_intentar_ultima_version`: las sin intentar solo en la última
  versión de cada plan, el mismo alcance que el barrido; las de versiones
  antiguas siguen en `paradas_sin_intentar` y nunca bajarán.

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

## Diagnóstico del relleno a cero (octubre)

Síntoma: con los datos de DEV el relleno ubicaba 0 de 467 paradas
(`relleno.paradas_resueltas = 0`). Solo se había probado con destinos limpios.

**Lo que no se pudo medir en la etapa de desarrollo.** La sesión que escribió
el arreglo no tiene el bypass de solo lectura del despliegue de dev ni el rol
de lectura de la base, así que las cifras agregadas de `/api/salud`
(`relleno.*` y `trabajador.ultimoResultado`) no están aquí. Quien juzga el
bloque las toma con `GET /api/salud` **antes** de que el trabajador ejecute el
commit del arreglo y las deja en la tabla de abajo; las cifras «después» salen
de rel-ac5. Hasta entonces las celdas dicen «pendiente de lectura» y no se
inventa ninguna. Solo enteros y categorías: ningún destino, nombre de parada,
id ni correo entra en este documento.

| Lectura de `/api/salud` (antes del arreglo) | Valor |
| --- | --- |
| `relleno.paradas_total` (todas las versiones) | pendiente de lectura |
| `relleno.paradas_resueltas` | pendiente de lectura |
| `relleno.paradas_no_resueltas` / `paradas_en_error` | pendiente de lectura |
| `relleno.paradas_sin_intentar` / `paradas_sin_intentar_ultima_version` | pendiente de lectura |
| `relleno.paradas_con_toponimo` | pendiente de lectura |
| `relleno.planes_con_version` / `planes_con_ciudad` / `planes_sin_ciudad_identificable` / `versiones_multiciudad` | pendiente de lectura |
| `trabajador.ultimoResultado`: `planes_mirados`, `paradas_intentadas`, `planes_saltados_sellados`, `planes_saltados_por_red`, `peticiones_nominatim_ciudad` | pendiente de lectura |

### Hipótesis

- **(a) Planes sellados con la versión vigente.** Pendiente de cifra
  (`planes_saltados_sellados` frente a `planes_mirados`). El código no la
  sostiene por sí sola: un sellado solo se salta con `version_resolutor` igual
  a la vigente, y la 6 se subió en el último cambio de criterio.
- **(b) Planes inconclusos tick tras tick por presupuesto.** **Confirmada en
  código y reproducida** con `relleno-descriptivo.test.ts` (falla en el commit
  anterior al arreglo). Con un destino descriptivo cuya caja es un punto sin
  área («Ciudad con niños» → 0×0), `intentarCajaDelDestino` recorre la muestra
  de hasta 11 sitios en una caja que `spanValido` rechaza de entrada, y
  `candidatosDesdeTextoDestino` prueba «Ciudad» y «Ciudad con», que
  geocodifican a un asentamiento real y gastan 1 + 12 peticiones cada uno. El
  tope de 12 por plan se agota antes de `deducirPorParadas`, el resultado es
  inconcluso y se contaba como fallo de red. Cifra de la reproducción: 0
  paradas ubicadas y ciudad `null` tras el primer tick con el código anterior;
  ciudad resuelta por paradas con el arreglo.
- **(c) Negativos cacheados reutilizados.** **Confirmada en código.** La clave
  de `buscarNominatim` (`nominatim:<cualificador>:<nombre>`) no llevaba la
  caja, así que un `[]` obtenido con `bounded=1` en una caja degenerada se
  reutilizaba 30 días para el mismo cualificador. Cifra real de entradas
  afectadas: pendiente de lectura.
- **(d) Paradas que son frases de actividad.** Existen (el fixture las
  reproduce) y no se ubican por diseño; no explican un cero total, solo un
  techo por debajo del 100 %. Cifra: `paradas_con_toponimo` frente a
  `paradas_total`, pendiente de lectura.
- **(e) La cifra 467 cuenta versiones antiguas.** **Plausible, sin cifra.**
  `paradas_total` suma todas las versiones y el barrido solo toca la última
  (`paradas_sin_intentar_ultima_version` lo separa). Explica que el
  denominador sea grande, no que el numerador sea cero.

### Arreglo

D1 (caja inválida sin gastar la muestra), D2 (candidatos genéricos
excluidos), D3 (la caja entra en la clave de caché), D4
(`VERSION_RESOLUTOR_ACTUAL` = 7, para que los sellados se reintenten una vez) y
D5 (`planes_saltados_por_presupuesto` aparte de `planes_saltados_por_red`). No
cambian las formas de `planes.ciudad` ni `paradas.resolucion`, ni los topes de
120 por tick y 12 por plan.
