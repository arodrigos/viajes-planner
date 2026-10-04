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
radio y la etiqueta OSM de la categoría.

**Nunca salen** hacia ninguno de estos servicios: fechas del viaje, edades
ni número de personas, el correo del usuario, ni ningún otro campo de
`criterios`. Desde el navegador del usuario solo sale, hacia OpenFreeMap,
la zona del mapa que está mirando (coordenadas de las teselas) -nunca
ningún dato del plan.
