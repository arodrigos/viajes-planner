# Fuentes de datos

Este documento explica de dónde salen el mapa, las coordenadas y las fotos
de cada parada, y qué datos del usuario llegan a cada sitio. Lo exige el
diseño del bloque `lugares-resolucion` y lo amplía cada bloque que use uno
de estos servicios (`mapa-del-dia`, `fotos-paradas`, `alternativas-equivalentes`).

## Fuentes y políticas de uso

Los cuatro servicios siguientes son los únicos aprobados por Adrián
(2026-10-03): gratuitos, sin cuenta, sin clave. Ninguna otra fuente de
mapas, lugares o fotos puede usarse sin su aprobación explícita.

- **OpenFreeMap** (`tiles.openfreemap.org`): teselas vectoriales del estilo
  "liberty" para el mapa interactivo del día. Sin registro, sin clave, sin
  cookies, sin límite de vistas. Llamado SOLO desde el navegador del
  usuario (componente cliente `MapaDia.tsx`); el servidor nunca lo llama.
- **Nominatim** (`nominatim.openstreetmap.org`): geocodificador de la
  OpenStreetMap Foundation. Resuelve el nombre de cada parada contra
  coordenadas reales. Política de uso estricta: máximo 1 petición/segundo,
  un solo hilo en vuelo, `User-Agent` identificable obligatorio, caché
  obligatoria de resultados (también los negativos). Llamado SOLO desde el
  trabajador de VPS1 (`src/lib/lugares/fuenteAbierta.ts`).
- **Wikipedia y Wikimedia Commons** (`*.wikipedia.org`, `commons.wikimedia.org`,
  `upload.wikimedia.org`): respaldo de resolución cuando Nominatim no
  acepta ningún candidato, y origen de la foto de cada parada (REST
  `page/summary` + `imageinfo` de Commons). Llamado SOLO desde el
  trabajador de VPS1.
- **Overpass API** (`overpass-api.de`): consulta pública de OpenStreetMap
  por etiqueta, usada para completar alternativas cercanas cuando el
  modelo no propuso suficientes. Llamado SOLO desde el trabajador de VPS1,
  con la consulta QL construida exclusivamente desde el enum cerrado de
  categorías y números (nunca desde texto libre).

Límites de ritmo comunes a Nominatim, Wikipedia/Commons y Overpass: pausa
de 30 s y un único reintento ante HTTP 429/5xx; ninguna de estas URLs se
llama desde `src/app` (la mitad web), solo desde el trabajador.

## Ciudad efectiva del plan

Un destino descriptivo ("Londres en familia con niños", "Ciudad con
niños") nunca geocodifica por sí mismo, así que sin esto ninguna parada de
esos planes resolvía nada: no había caja contra la que buscar. Antes de
resolver las paradas, el trabajador calcula la **ciudad efectiva** del
plan (`src/lib/lugares/ciudad.ts`) en tres pasos, siempre contra Nominatim
y con la misma política de ritmo/caché/`User-Agent` de más arriba:

Las paradas que se usan como muestra de validación (pasos 1 y 2) y las que
se consultan en la deducción (paso 3) se eligen con el mismo orden
determinista: **pocos tokens primero, luego el nombre más corto, luego
alfabético** -- no "más tokens primero" como en una versión anterior de
este documento. Medido contra Nominatim real (feedback del gatekeeper,
2026-10-04): los nombres de SITIO que de verdad geocodifican ("Hyde Park")
son casi siempre más cortos que las paradas descriptivas de un plan
("Tarde libre en familia por el centro de la ciudad"); con el orden
antiguo, un plan mixto llenaba la muestra con las descriptivas y nunca
llegaba a los monumentos.

1. **Caja del destino**: geocodifica el destino tal cual y comprueba una
   muestra de al menos 5 paradas (si no llega a 2 aceptadas, sigue
   recorriendo paradas hasta un tope de 12 antes de rendirse) contra esa
   caja; si al menos 2 resuelven y la caja no es desmesurada ni degenerada
   (0 grados de span), la ciudad efectiva es el propio destino.
2. **Candidato de nombre extraído del destino**: si el paso anterior no
   resuelve, prueba hasta 3 nombres de ciudad derivados del propio texto
   del destino (quitando colas cualificadoras conocidas como "en familia
   con niños" o "de fin de semana", y los primeros tokens del texto),
   geocodificando cada uno por separado y validándolo contra la misma
   muestra creciente (5 a 12 paradas) -- un nombre de ciudad sin ninguna
   parada que lo confirme no se acepta, aunque Nominatim devuelva una caja
   real para él.
3. **Deducción por paradas**: si ningún candidato anterior resuelve, busca
   libremente (sin acotar por caja) hasta 8 nombres de parada distintos (en
   el mismo orden de pocos tokens primero) y vota la ciudad por los
   niveles de dirección que devuelve Nominatim (ciudad → distrito →
   región), verificando geográficamente a quien gana antes de aceptarlo.
   Sin un ganador claro, el plan queda `sin-ciudad-identificable` con el
   motivo y no se vuelve a reintentar en cada tick.

A partir de ahí, **todo** cualificador geográfico y toda clave de caché de
ese plan usan el nombre de la ciudad efectiva, nunca el texto crudo del
destino -un plan con un destino descriptivo y uno con el mismo destino
escrito distinto comparten exactamente la misma caché una vez resuelta la
ciudad. Un plan cuya ciudad ya está resuelta no repite ninguna de estas
búsquedas.

## Atribución y licencias

- El mapa muestra siempre el control de atribución de MapLibre sin
  colapsar (`compact: false`), con "OpenFreeMap", "OpenMapTiles" y
  "OpenStreetMap" y sus enlaces -requisito de la licencia ODbL de los
  datos y del estilo de OpenFreeMap, no una elección estética.
- Cada foto guarda junto a la imagen su autor, licencia (con enlace) y la
  página de origen, leídos del `extmetadata` del propio fichero de
  Commons -nunca del título ni de quien lo subió-, y se pintan siempre en
  la tarjeta de la parada. Solo se aceptan licencias de una lista blanca
  (CC0, dominio público, CC BY 1.0–4.0, CC BY-SA 1.0–4.0); si la licencia
  no está en esa lista, no hay foto.
- Cada parada comprobada enlaza a su fuente real (OpenStreetMap o
  Wikipedia) para que cualquiera pueda verificarla.

## Qué datos salen y hacia dónde

Solo el **nombre de la parada tal como lo propuso el modelo** y el
**destino del viaje** (p. ej. "Museo del Prado, Madrid") salen hacia
Nominatim y Wikipedia, además de un `User-Agent` que identifica la
aplicación y el repositorio (`viajes-planner/<versión>
(+https://github.com/arodrigos/viajes-planner)`), nunca a una persona.
Hacia Overpass solo salen coordenadas (redondeadas a 3 decimales), un
radio y la etiqueta OSM de la categoría. La deducción de la ciudad
efectiva manda solo el nombre de cada parada, sin el destino -nunca
construye una consulta con datos personales del plan.

**Nunca salen** hacia ninguno de estos servicios: fechas del viaje, edades
ni número de personas, el correo del usuario, ni ningún otro campo de
`criterios`. Desde el navegador del usuario solo sale, hacia OpenFreeMap,
la zona del mapa que está mirando (coordenadas de las teselas) -nunca
ningún dato del plan.
