# viajes-planner

## Qué es esto

Planificador de viajes turísticos personal y familiar. Recibe criterios y
limitaciones y devuelve un plan optimizado por días, con una guía
interactiva en destino.

Es un producto **personal, sin monetización**. De esa condición dependen el
plan Hobby de Vercel, OpenFreeMap y la reutilización de contenido con
licencia compartir igual. Las reglas que impone al código están en
`CLAUDE.md`.

## Funcionalidades

- **Acceso con código por correo**: solo pueden pedirlo los correos de la
  lista blanca (`CORREOS_PERMITIDOS`).
- **Criterios del viaje**: destino o tipo de viaje, fechas o época, número
  de días, personas y edades, perfil, presupuesto, cómo moverse entre
  ciudades, ritmo, intereses y, opcionalmente, el alojamiento ya reservado.
- **Ritmo e intereses** en el formulario de criterios: ritmo `tranquilo`,
  `normal` o `intenso` (mueve una parada arriba o abajo el tope por franja
  del perfil) y hasta 3 intereses de una lista cerrada (museos, naturaleza,
  gastronomía, parques y juegos para niños, monumentos, compras). Los
  intereses solo viajan al prompt del modelo; la tarjeta de parada dice
  «Encaja con tu interés: …» cuando su categoría casa con uno de ellos
  (`src/lib/criterios/intereses.ts`).
- **Vista por días**: resumen del viaje, selector de día, un solo mapa y
  menú de opciones. Incluye la ruta entre ciudades, los eventos de cada día
  y «Más sitios recomendados».
- **Tarjeta de parada** compacta, con paneles que se abren de uno en uno:
  por qué se propone, consejos y curiosidades, y alternativas.
- **Tarjeta «Ahora»** en el día de hoy: siguiente parada, progreso, hora
  de salida hacia la siguiente y marcar como visitada.
- **Tramos y horario** entre paradas consecutivas (medio, tiempo estimado y
  enlace), calculados por distancia, sin API de rutas. Un único modelo
  (`src/lib/plan/tiempos.ts`) da los mismos minutos al conector, al rango
  «HH:MM – HH:MM» de la tarjeta, al «sal a las» de «Ahora» y al .ics: a pie
  a 3,5 km/h con perfil familiar y 4 km/h con el resto, distancia en línea
  recta × 1,3, redondeo a 5 min (mínimo 5) como único colchón, y 15 min si
  falta la ubicación de alguna de las dos paradas. Si un tramo es en
  transporte o coche, el horario cuenta ese modo. Una parada que no cabe en
  su franja conserva su duración y avisa «Se pasa N min del final de la
  mañana».
- **Alternativas**: sustituir una parada por una alternativa, con su guía.
- **Orden del día**: subir y bajar paradas, arrastrarlas por el asa,
  «Optimizar orden» (recorrido más corto) y deshacer.
  Si el plan cambió en otra pantalla, recoloca las paradas con la versión
  más reciente y lo dice como información.
- **Sitios propios**: «Añadir un sitio» a un día, con nombre (2 a 80
  caracteres) y una nota opcional (hasta 200). El trabajador lo busca después
  como cualquier otra parada; la tarjeta enseña el estado de la búsqueda
  (buscando, encontrado, no encontrado o error) y permite corregir el nombre o
  quitar el sitio. Como mucho 20 sitios esperando búsqueda a la vez. La nota
  es privada: no sale a ningún servicio externo ni al modelo, pero sí va al
  `.ics` del calendario y la ve quien tenga acceso al plan.
  Si no se ha podido identificar la ciudad, se puede decir a mano.
- **Compartir en solo lectura**: el dueño invita desde la sección
  «Compartir» del plan a correos que ya están en `CORREOS_PERMITIDOS` (hasta
  10 por plan) y puede quitarles el acceso. El invitado ve el plan en «Mis
  viajes» con la etiqueta «Compartido contigo» y lo abre en solo lectura: ve
  días, paradas y notas, pero no el presupuesto, el alojamiento, los costes de
  traslado ni la ficha de Google, y no puede cambiar nada (ni orden, ni
  sitios, ni alternativas, ni visitas). La proyección se recorta en el
  servidor (`src/lib/plan/compartido.ts`) y todas las rutas de escritura
  exigen ser el dueño. Si el dueño retira el acceso, la copia guardada del
  invitado se borra cuando vuelve a abrir el plan con conexión.
- **Añadir al calendario**: descarga un `.ics` del plan.
- **Infografía**: lámina del plan, visible dentro de él.
- **Sin conexión**: la app se instala (PWA) y un service worker (Serwist)
  guarda una copia del plan y de sus fotos para abrirlo sin red. Además, el botón «Guardar mapas para
  usar sin red» descarga en el dispositivo los mapas de cada día con
  paradas ubicadas, con aviso previo del tamaño estimado y del progreso. Solo
  descarga al pulsarlo y con los límites que pide OpenFreeMap (zooms 10 a 14,
  como mucho 150 teselas por día, 3 peticiones a la vez y parar a la primera
  respuesta 429 o 5xx); detalle en `docs/fuentes-de-datos.md`, «Mapas sin
  conexión». Lo guardado se borra al cerrar sesión o al eliminar el plan.
- **Opiniones y horario · Google Maps**: panel de la tarjeta de parada con la
  ficha oficial de Google del sitio, solo para las paradas casadas con su
  lugar de Google.
- **Mis viajes**: Próximos y Pasados, con fechas legibles y la situación de
  cada viaje; eliminar un viaje, pedir otro y regenerar un plan.
- **Páginas públicas**: `/guia` (cómo funciona la aplicación), `/terminos` y
  `/privacidad`, enlazadas en el pie.

## Stack y dependencias

- **Next.js (App Router) + TypeScript** estricto, desplegado en **Vercel**.
- **Supabase** (Postgres, Auth y RLS) dentro de un proyecto compartido, con
  el esquema propio `viajes_planner`. Los datos solo los lee y escribe el
  servidor con la clave de servicio: `anon` y `authenticated` no tienen
  ningún privilegio sobre el esquema (migración 035), así que la API REST les
  responde «permiso denegado». Toda migración que cree una tabla, secuencia
  o función repite su `revoke` a `anon`/`authenticated` y el `grant` a
  `service_role`; `scripts/verificar-bd-prueba.sh privilegios` lo comprueba
  y `scripts/verificar-privilegios-reales.sh` lo vigila en DEV tras migrar.
- Copia sin conexión con **Serwist** (service worker, `src/app/sw.ts`) y
  cálculo de teselas para los mapas guardados con `@mapbox/tilebelt`.
- Mapa con **MapLibre** sobre **OpenFreeMap**. Lugares y fotos desde
  **Nominatim**, **Overpass API** y **Wikipedia/Wikimedia Commons/Wikidata**:
  servicios abiertos y sin cuenta (detalle en `docs/fuentes-de-datos.md`).
- **Google Maps Platform**, solo en la capa gratuita y con dos usos
  acotados: Places Text Search desde el trabajador para casar el `place_id`
  y el Places UI Kit (`gmp-place-details`, vía `@googlemaps/js-api-loader`)
  en el navegador para la ficha. Lo único que se guarda de Google es el
  `place_id`.
- **dnd-kit** para arrastrar paradas e **ics** para el calendario.
- Tests: **Vitest** (unitarios y de integración) y **Playwright** (e2e en
  móvil y escritorio, con goldens visuales).

## Arquitectura / estructura de carpetas

Dos mitades que no se pisan:

- **Web (Vercel).** Sirve la interfaz, guarda los viajes y encola trabajos
  en la base de datos. No habla con ningún modelo y no tiene ninguna
  credencial de modelo.
- **Trabajador (fuera de Vercel).** Un tick por cron toma trabajos de la
  cola y los resuelve con Claude Code en modo no interactivo, bajo una
  suscripción y no con una clave de API facturada por token.
  - Entrada: `scripts/trabajador-tick.ts`.
  - Lógica: `src/lib/trabajador/`.
  - En cada tick también rellena y reprocesa lo guardado con un formato
    antiguo (`docs/relleno-de-planes.md`) y casa con Google los lugares
    pendientes (ver más abajo).
  - Todas las fases del barrido de un tick comparten un único cupo de **120
    peticiones** a servicios externos (Nominatim, Wikipedia/Commons,
    Overpass; `PRESUPUESTO_PETICIONES_POR_TICK` en
    `src/lib/trabajador/presupuestoTick.ts`), repartido en orden de
    prioridad: lo que no cabe espera al siguiente tick. Cuenta también las
    llamadas que resuelve la caché, así que es una cota superior. El
    resultado del tick lo publica como `peticiones_externas`.

### Mapa de carpetas

Dónde buscar cada cosa antes de leer el detalle de cada funcionalidad:

| Carpeta | Qué hay |
|---|---|
| `src/app/` | Páginas (`criterios`, `trabajos/[id]`, `plan/[id]`, `viajes`, `guia`…), el service worker (`sw.ts`) y las rutas de API. Los e2e viven junto a la pantalla que prueban (`*.e2e.ts`, `*.movil.e2e.ts`) |
| `src/app/api/` | Manejadores de API (`manejador.ts`) repartidos por los dos despachadores (ver «Tamaño del despliegue de Vercel») |
| `src/lib/` | Lógica sin interfaz, una carpeta por dominio: `plan` (tipos, tiempos, horario, conflictos, compartir), `criterios`, `cola` (trabajos encolados), `trabajador` (la mitad que piensa), `lugares` y `guia` (fuentes abiertas), `google`, `etapas` (viajes multiciudad), `alternativas`, `eventos`, `reservas`, `gastos`, `presupuesto`, `infografia`, `sinConexion`, `auth`, `db`, `textos` (todos los textos visibles) |
| `src/verificacion/` | Suite preview contra un despliegue publicado (no corre en el CI) |
| `src/test-utils/` | Ayudas de los e2e: capturas, sesiones y la lista de capturas esperadas |
| `scripts/` | Tick del trabajador, comprobaciones del CI (`verificar-*.sh`, `comprobar-*.mjs`) y generadores de ejemplos y goldens |
| `supabase/` | Configuración de la pila local y migraciones numeradas del esquema `viajes_planner` |
| `fixtures/` | Criterios de ejemplo y respuestas grabadas de servicios externos para los tests sin red |
| `docs/` | Diseño de detalle: fuentes de datos, guía de estilo, relleno de planes, verificación con sesión y viajes por país |
| `assets/fuentes/` | Fuentes tipográficas de la infografía |

### Curiosidades verificadas

Las curiosidades de cada parada son frases **literales** de Wikipedia y
Wikidata. El modelo solo elige, entre candidatas ya extraídas y saneadas,
cuáles mostrar; no redacta ninguna.

- Las reglas que deciden qué frase vale (saneado, cortes de frase,
  abreviaturas, siglas, edificio frente a institución) tienen una huella
  (`src/lib/guia/huella.ts`).
- `MIN_FRASE` (`src/lib/guia/candidatas.ts`, hoy **15**) es la longitud
  mínima, en caracteres, de una frase candidata; el máximo es `MAX_FRASE`
  (300). Bajó de 20 a 15 para no descartar frases cortas con año del tipo
  «It opened in 1910.». Los dos umbrales forman parte de la huella.
- `FORMATO_CURIOSIDADES` (`src/lib/guia/curiosidadesPlan.ts`, hoy **6**) es
  la versión de esas reglas. Si cambian las reglas o los umbrales sin subir
  el formato, falla el test de la huella.
- Al subir el formato, el trabajador rehace las curiosidades de la última
  versión de cada plan guardado (reproceso). `/api/salud` cuenta las que
  aún están en un formato antiguo.

### Google: casado del `place_id` y ficha

**Casado en el trabajador** (`src/lib/trabajador/google/casar.ts`). En cada
tick, si el trabajador tiene `GOOGLE_PLACES_CLAVE`:

- Toma las paradas de la última versión de cada plan con lugar comprobado
  (OSM o Wikipedia) y coordenadas, una por lugar y con el viaje más próximo
  primero. Sin ancla no hay petición.
- Solo llama a Places **Text Search** cuando el lugar no tiene fila en
  `lugares_google`, cuando está `obsoleto` o en `error`, cuando lleva más de
  30 días `sin-coincidencia` o cuando su casado tiene más de 12 meses.
- Pide solo `places.id` y `places.location` con el nombre de la parada y la
  ciudad, restringido a un rectángulo alrededor del ancla. Acepta el primer
  resultado a menos de 300 m (1.000 m en parques, playas, naturaleza,
  barrios, plazas y miradores) y descarta la ubicación.
- Como mucho 20 lugares por tick. Antes de cada petición reserva cupo con
  `reservar_cupo_google`: Text Search tiene un tope propio de **45 al día** y
  1.350 al mes, por debajo de la cuota de la consola. Si no hay cupo, o si el
  contador falla, para y deja el resto para otro tick.
- Sin clave no hace nada (así corren el desarrollo local y los tests).

**Ficha en la UI** (`src/app/plan/[id]/FichaGoogle.tsx`). La tarjeta de
parada tiene el panel «Opiniones y horario · Google Maps»; la tarjeta
«Ahora» y el aviso de horario de OSM («Compruébalo en Google») lo abren. No
se contacta con Google hasta la primera apertura. Entonces la página pide el
`place_id` a `POST /api/google/ficha`, que comprueba la sesión y que el plan
es del usuario, y reserva una carga de UI Kit (tope propio de 250 al día,
7.500 al mes y 80 por usuario y día). El navegador solo conoce el estado de
cada parada (`casado`, `sin-coincidencia`, `pendiente`, `sin-ubicacion`); el
`place_id` solo sale por esa ruta. Si Google responde `NOT_FOUND`, el lugar
se marca `obsoleto` y el trabajador lo vuelve a casar. Sin clave de
navegador, sin casar o sin cupo, el panel lo dice y enlaza a Google Maps.

### Orden de paradas

`POST /api/plan/[id]/orden` guarda el orden de un día como una versión nueva
del plan, con la función SQL `reordenar_dia_plan` (solo `service_role`).
Responde 409 `version-desfasada` si la última versión no es la que la persona
tenía en pantalla, y la UI recoloca las paradas con la versión más reciente y
enseña un aviso informativo.

La función bloquea la fila del plan (`for update`), pero los clones de
versión del trabajador no lo hacen. Si un clon se lleva la versión N+1 entre
la lectura de la última versión y el insert de la reordenación, salta el
`unique (plan_id, version)` (`unique_violation`, SQLSTATE 23505). La función
(migración 034) traduce ese error a `version-desfasada`, y la ruta (y
`errorDeFuncionSitio` para los sitios propios) trata además cualquier error
con `code` 23505 como 409, nunca como 500. El CI lo comprueba contra la pila
local de Supabase:
`BD_URL=<url de la base de pruebas> bash scripts/verificar-bd-prueba.sh choque`.

### Conflictos de horario

Cada día del plan avisa de las paradas que, según el `opening_hours` de
OpenStreetMap, estarían cerradas en su franja o a la hora a la que se llega
(`src/lib/plan/apertura.ts` y `src/lib/plan/conflictos.ts`). Solo un cerrado
claro cuenta como conflicto: una etiqueta ausente, no interpretable, con
tramos `unknown` o con festivos (`PH`/`SH`) sin país se rotula «Horario sin
confirmar» y no suma al contador. Esperar a que un sitio abra no es conflicto.
Se calcula al leer, en el navegador y con un `import()` diferido (la librería
`opening_hours` va en su propio chunk); no se guarda nada en el plan. El
servidor solo añade a cada parada la regla y las horas ya calculadas
(`horario.fuenteOsm.regla`, `horario.minutos`).

«Optimizar orden» no propone un orden que deje cerrado un sitio que hoy no lo
está: con hasta 8 paradas ubicadas enumera los órdenes posibles y, si ninguno
mejora sin añadir conflictos, deja el orden como está y lo dice.

### Arreglar un conflicto con un toque

Junto al aviso de una parada en conflicto, el dueño del plan ve «Arreglar». Abre
una hoja desde abajo con hasta tres opciones, cada una con su motivo («Llevar
al martes: abre de 10:00 a 18:00»): otra franja del mismo día, el día más
cercano del viaje (sin cruzar de ciudad) o una alternativa guardada de la
parada. `proponerArreglos` (`src/lib/plan/arreglos.ts`) solo ofrece lo que,
aplicado, no crea otro conflicto y deja la visita entera dentro de su franja
de destino (si se saldría de ella, esa opción no aparece y se prueba la
siguiente; ninguna opción recorta la duración), y nunca propone quitar la
parada. Cada
arreglo es una versión nueva del plan y el aviso «Movida al … · Deshacer» dura
8 s: Deshacer devuelve la parada a su día, su franja y su posición. Si el
servidor falla, la pantalla vuelve a como estaba y lo dice.

Mover a otro día es `POST /api/plan/[id]/paradas/[paradaId]/mover-dia`
(`version_base`, `dia_origen`, `dia_destino`, `franja_id`, `posicion` opcional),
con la función SQL `mover_parada_a_dia` (migración 036, solo `service_role`) y
el mismo tope de 30 versiones por hora que el orden. Otra franja usa `/orden`
y la alternativa usa `/sustituir`. Para pintar sus opciones, el navegador
recibe además la ventana en minutos de cada franja (`ventana`) y la regla OSM
de cada alternativa (`fuenteOsm`).

Para probarlo a mano, abre un plan con `?pruebas=1` y ejecuta en la consola
`__debug.forzarHorarioParada({ paradaId, opening_hours: "Mo off; Tu-Su 10:00-18:00" })`.
Solo cambia la etiqueta en el navegador; sin `?pruebas=1` el gancho no existe.

### Sitios propios y compartir

- **Sitios propios** (migración 031): `paradas` tiene `nota` (≤ 200
  caracteres) y `propia`. `POST /api/plan/[id]/sitios` y `PATCH`/`DELETE
  /api/plan/[id]/sitios/[idExterno]` llaman a las funciones SQL
  `anadir_sitio_propio`, `corregir_sitio_propio` y `quitar_sitio_propio`,
  que crean la versión siguiente del plan en una sola transacción (nunca
  escriben sobre una versión existente) y responden 409 si la versión de
  partida está desfasada. `clonar_version_plan` copia las dos columnas
  nuevas. Ni el trabajador ni la guía leen `nota` (lo vigila
  `src/lib/trabajador/__tests__/nota-no-sale.test.ts`).
- **Compartir** (migraciones 032 y 033): tabla `miembros_plan` (plan,
  correo en minúsculas, quién invitó). Solo la toca la web con la clave de
  servicio, a través de `GET`/`POST /api/plan/[id]/miembros` y `DELETE
  /api/plan/[id]/miembros/[miembroId]`, que solo admiten al dueño (un miembro
  recibe 403 y un ajeno 404). La 033 quita a `authenticated` el `SELECT`
  sobre la tabla. `rolEnPlan` y `exigirDuenyo` (`src/lib/plan/propiedad.ts`)
  deciden el rol en cada ruta.

### Reservas con hora fija

- **Reservas** (migración 037): tabla `reservas` (vuelo, tren, hotel o entrada
  con hora; hasta 30 por viaje) con RLS activada y sin políticas, igual que
  el resto: solo la toca la web con la clave de servicio. Las rutas `GET`/`POST
  /api/plan/[id]/reservas` y `PATCH`/`DELETE /api/plan/[id]/reservas/[reservaId]`
  solo admiten al dueño (un invitado o un ajeno recibe 404, sin sesión 401).
  Las reglas viven en `src/lib/reservas/validar.ts` y el `CHECK` de la tabla
  las repite; hora local de pared, sin conversión de zona.
- El invitado solo recibe en el JSON del plan `reservas` con id, tipo,
  sentido, fecha y hora (`src/lib/reservas/publico.ts`); localizador, nombres,
  direcciones y notas no salen del servidor.
- La ubicación del hotel es opcional: se toma del dispositivo o se pega y se
  interpreta en local, sin llamar a ningún mapa.
- **En el día**: cada reserva con hora sale como tarjeta fija con candado en
  su día (llegada, salida, entrada; el hotel, el día de entrada) y no se mueve
  nunca: guardar una reserva no crea versión del plan ni cambia paradas
  (`src/lib/reservas/enElDia.ts`). Dentro de su franja va en orden de hora
  (`intercalarFijos`): justo antes de la primera parada que empieza a su hora
  o más tarde; las paradas conservan su orden, una parada sin hora no sirve
  de referencia y, a igual hora, va primero la reserva. Una parada que pisa una entrada, que queda
  antes de 60 min tras la llegada o después de 120 min (vuelo) o 45 (tren)
  antes de la salida cuenta como conflicto, y «Arreglar» solo propone huecos
  que no chocan con ninguna reserva. El .ics lleva un evento por reserva, cada
  extremo en su zona horaria; el localizador solo va en el del dueño.
- Con la ubicación del hotel, «Optimizar orden» parte de él en los días de la
  estancia («Sales de: …», solo para el dueño); sin ubicación, el día lo
  avisa. La vista compartida muestra solo tipo y hora.
- Al eliminar un viaje se borran sus reservas de verdad (el borrado del viaje
  es una marca, así que no salta ningún `ON DELETE CASCADE`).

### Gastos del viaje

- **Gastos** (migración 038): tabla `gastos` (importe en céntimos, día o «Todo el
  viaje», categoría comida, entradas, transporte o alojamiento; hasta 500 por
  viaje) y función `guardar_gasto`, con RLS activada y sin políticas: solo la
  web con la clave de servicio. `GET /api/plan/[id]/gastos` y `PUT`/`DELETE
  /api/plan/[id]/gastos/[gastoId]` admiten solo al dueño (un invitado o un
  ajeno recibe 404, sin sesión 401). El id lo genera el cliente y el `PUT` es un
  upsert idempotente: repetirlo no duplica y uno más viejo no pisa al más nuevo.
- La fecha de un gasto tiene que ser un día del viaje (o ninguna, «Todo el
  viaje»). El formulario y el `PUT` aplican la misma regla (`validarGasto` con
  `fechasViaje`): el `PUT` lee los días del plan y responde 400 con el mismo
  texto que el formulario, «Elige un día válido del viaje», sin guardar nada.
  Si el plan no se puede leer, responde 500 en vez de aceptar sin comprobar.
- La sección «Gastos» de `/plan/[id]` compara lo gastado con el presupuesto
  estimado del plan (`src/lib/gastos/comparar.ts`, en céntimos enteros): el
  alojamiento solo contra el alojamiento estimado del viaje, el transporte a su
  día o a «Todo el viaje», comida y entradas a su día. La regla se repite en
  `src/lib/gastos/validar.ts` y en los `CHECK` de la tabla.
- Los invitados no reciben gastos, y al eliminar un viaje se borran de verdad.
- **Sin conexión**: alta, edición y borrado de gastos pasan siempre por una cola
  de salida en IndexedDB (`src/lib/sinConexion/colaSalida.ts`, genérica y
  reutilizable, sobre `idb`). Se intenta subir enseguida; si no hay red, el gasto
  sale con «Pendiente de subir» y arriba «N gastos sin subir», y los totales ya lo
  cuentan. Se sube solo al volver la red, al volver la página a primer plano y al
  abrir la sección, con el mismo id (el `PUT` es idempotente: nunca se duplica).
  Un 401 deja los gastos pendientes con «Inicia sesión para subir N gastos»; un
  rechazo (400, 409, 404) los deja en rojo con su motivo y «Editar» o «Descartar».
  La lista que se ve es el espejo del servidor guardado en el dispositivo más lo
  pendiente. Al cerrar sesión y al eliminar el viaje se vacían la cola y el espejo
  (`src/lib/sinConexion/borrar.ts`). No toca el service worker.

### Pedir el código de acceso: qué ve la persona y qué se registra

`POST /api/acceso/solicitar-codigo` responde siempre el mismo `200` con el
mismo mensaje («Si tu correo está autorizado, te llegará un código en un
minuto. Si no te llega, espera un minuto y vuelve a pedirlo.») tanto si el
correo está autorizado como si no, y también cuando Supabase Auth rechaza el
envío: así nadie puede averiguar quién está en la lista. El detalle real va
solo al log del servidor (`console.warn`, evento `solicitar-codigo-rechazado`,
con `tipo`, `http_equivalente`, `status` y `code`; nunca el mensaje de Auth ni
el correo).

| Situación | Lo que ve la persona | Log (`http_equivalente`) | Qué hacer |
|---|---|---|---|
| Envío correcto, o correo no autorizado | El aviso fijo | Sin entrada | Nada |
| Límite de envíos (`over_email_send_rate_limit`, `over_request_rate_limit`) | El aviso fijo | `tipo: limite-envios`, `429` | Esperar un minuto; si se repite, el SMTP por defecto de DEV tiene un límite de envíos por hora muy bajo y es compartido |
| Dirección rechazada (`email_address_invalid`, `email_address_not_authorized`) | El aviso fijo | `tipo: correo-invalido`, `400` | El SMTP por defecto solo envía a direcciones autorizadas del proyecto |
| Error de Auth no clasificado o Supabase caído | El aviso fijo | `tipo: fallo-envio`, `502` | Revisar el estado de Supabase Auth |
| Lista blanca vacía | Texto genérico de fallo | `500` real | Arreglar `CORREOS_PERMITIDOS` |

El tiempo de respuesta puede diferir entre un correo autorizado y uno que no
(el segundo no llama a Supabase): fuga residual de temporización conocida y no
tratada.

Pruebas y UAT no llaman nunca a `signInWithOtp` contra el Supabase real, para
no gastar el límite de envíos compartido: usan dobles del cliente,
`page.route`, o entran con `/admin/generate_link` y un usuario de prueba ya
existente.

### Salud del despliegue

`GET /api/salud` responde 200 si todo está en orden y 503 si no. Informa de:

- la conexión con Supabase y el esquema;
- cuándo se vio por última vez al trabajador, su commit y su último
  resultado;
- los secretos que faltan, y que no haya credenciales de modelo en la web;
- `relleno`: contadores agregados del relleno (paradas resueltas, con foto,
  guía, alternativas, `curiosidades_formato_antiguo`, planes con ciudad…).
  Salen de una sola llamada por rpc a la función SQL `estado_relleno`, a la
  que se pasa el `FORMATO_CURIOSIDADES` vigente, con 60 s de caché en
  memoria. Solo se publica si trae exactamente las claves esperadas y todas
  son enteros no negativos. Una segunda rpc, `estado_relleno_motivos`, añade
  por qué quedan paradas «no-resuelta» (`paradas_no_resueltas_*`, por
  `resolucion.categoria_motivo`), el denominador `paradas_con_toponimo` y
  `paradas_sin_intentar_ultima_version`; si falla o aún no existe, `relleno`
  sale igual sin esas siete claves;
- `google`: `text_search_hoy`, `text_search_mes`, `ui_kit_hoy` y `ui_kit_mes`
  (por rpc a `consumo_google_resumen`, con el día de Google, hora del
  Pacífico), `lugares_casados` y `lugares_sin_coincidencia` (recuentos de
  `lugares_google`), y `clave_trabajador` y `clave_navegador`, que valen 1 o
  0 según la clave esté presente. Nunca expone el valor de una clave ni un
  `place_id`;
- la pasada de alternativas del trabajador.

Si falla la lectura de `relleno` o de `google`, ese bloque se omite y el
resto de la respuesta sigue. Nunca devuelve texto crudo de errores. El cron diario de Vercel la llama a
las 07:00 UTC (`vercel.json`).

```
src/app/            páginas (criterios, plan, guía, mis viajes, sin conexión, términos, privacidad), service worker (sw.ts) y API (acceso, auth, plan, trabajos, viajes, google, salud)
src/lib/criterios/  esquema y validación de los criterios, ritmo e intereses
src/lib/plan/       modelo del plan, días, tramos, sitios propios, miembros y proyección compartida
src/lib/sinConexion/  reglas del service worker, copia del plan y mapas guardados
src/lib/lugares/    resolución de lugares, ciudades y fotos con fuentes abiertas
src/lib/guia/       consejos y curiosidades de cada parada (reglas, huella y reproceso)
src/lib/alternativas/  alternativas de paradas y su equivalencia
src/lib/infografia/ lámina del plan
src/lib/google/     cupo de Google, estados por parada, ficha y resumen para /api/salud
src/lib/cola/, src/lib/trabajador/  cola de trabajos y su procesado (incluido el casado con Google)
src/verificacion/   suite preview de Playwright contra un despliegue publicado
src/lib/db/         cliente de Supabase atado al esquema del producto
supabase/migrations/  migraciones versionadas y solo aditivas (hoy hasta la 037)
docs/               fuentes de datos, guía de estilo, relleno de planes, verificación con sesión y viajes por país
.github/workflows/  CI, reintento del CI y «Pruebas a demanda»
```

## Ramas y despliegue

- **`dev`** es la rama de trabajo y la rama por defecto. Los PRs van contra
  `dev`. Un push a `dev` pasa el CI, aplica las migraciones pendientes al
  Supabase de desarrollo y despliega la preview de Vercel, protegida con
  login.
- **Solo `dev` despliega en Vercel.** `vercel.json` desactiva los
  despliegues automáticos de cualquier otra rama
  (`git.deploymentEnabled`): los PRs y las ramas de trabajo no generan
  preview y solo se validan en el CI.
- **`main` es congelación, no despliegue.** Un merge a `main` marca una
  versión cerrada con su tag, pero no despliega nada. Pasar algo a
  producción es una decisión explícita, aparte, y con su propio
  procedimiento. Nadie mergea a `main` por su cuenta, aunque el cambio sea
  solo de CI o de documentación.
- El trabajador corre sobre la cabeza de `dev` y se actualiza solo antes de
  cada tick.

## Cómo arrancar en local

```bash
npm install
cp .env.example .env.local   # y rellena las variables de abajo
npm run dev
```

Node 22, la misma versión que usa el CI.
`npm install` copia además el worker de MapLibre a `public/` (`postinstall`).
`npm run build` falla si `CORREOS_PERMITIDOS` está vacía (`prebuild`). El
trabajador se lanza aparte con `npm run trabajador:tick`.

## Variables de entorno necesarias

Están en `.env.example`, salvo `SALUD_ORIGEN_TRABAJADOR`. Nunca se suben al
repo.

| Variable | Para qué |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase compartido (el de desarrollo en local y CI) |
| `SUPABASE_ANON_KEY` | Clave anónima: solo para el acceso con código por correo (`.auth.*`); no lee ni escribe datos |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio, solo en servidor |
| `SUPABASE_SCHEMA` | `viajes_planner`. Sin ella, el cliente falla en vez de caer a `public`, que es de otro producto |
| `CRON_SECRET` | Autoriza el cron diario de Vercel sobre `/api/salud` |
| `CORREOS_PERMITIDOS` | Lista blanca de correos que pueden pedir acceso. El build falla si está vacía |
| `NEXT_PUBLIC_GOOGLE_MAPS_CLAVE_NAVEGADOR` | Clave de navegador de Google (Maps JavaScript API y Places UI Kit) para la ficha. Se fija antes del build. Opcional: sin ella el panel avisa y enlaza a Google Maps |
| `SALUD_ORIGEN_TRABAJADOR` | Origen con el que el **trabajador** apunta sus filas de salud y que `/api/salud` busca: si se fija, con el mismo valor en los dos entornos. Opcional: por defecto `trabajador` |
| `GOOGLE_PLACES_CLAVE` | Solo en el entorno del **trabajador**, nunca en la web. Clave de Places API (New) para Text Search. Sin ella no se casa nada |

Opcionales, leídas por el código pero fuera de `.env.example` (sin ellas
se usa el valor por defecto que fija el propio código):

| Variable | Dónde se lee | Para qué |
|---|---|---|
| `VERCEL_GIT_COMMIT_SHA` / `COMMIT_SHA` | `src/lib/salud.ts`, `serwist.config.mjs` | Commit que publica `/api/salud` y que versiona el service worker. Vercel pone la primera; `COMMIT_SHA` es el equivalente fuera de Vercel |
| `NEXT_PUBLIC_SW_DESACTIVADO` | `src/app/RegistroSinConexion.tsx` | Con `1`, interruptor de emergencia: desregistra el service worker y vacía sus cachés en cada dispositivo |
| `TRABAJOS_LIMITE_POR_HORA`, `TRABAJOS_ARRENDAMIENTO_MIN`, `TRABAJOS_CADUCIDAD_HORAS` | `src/lib/cola/config.ts` | Límites de la cola de trabajos |
| `TRABAJADOR_MODELO`, `TRABAJADOR_CERROJO_TTL_MIN`, `TRABAJADOR_ESPERA_OCIOSA_MS`, `TRABAJADOR_INTERVALO_OCIOSO_MS` | `src/lib/trabajador/config.ts` | Solo en el **trabajador**: modelo de generación, cerrojo del tick y esperas en ocioso |

Las variables de la suite preview (`URL_OBJETIVO`, `CORREO_ACCESO`,
`CODIGO_ACCESO`, `CORREO_INVITADO`, `CODIGO_INVITADO`…) se describen más
abajo y en `docs/verificacion-con-sesion.md`.

Ninguna variable de modelo entra en el despliegue web: `/api/salud` avisa si
encuentra `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` o `CLAUDE_API_KEY`.
Las restricciones y cuotas de las dos claves de Google se configuran a mano
en su consola (`docs/fuentes-de-datos.md`, «Google Maps Platform»).

## Tamaño del despliegue de Vercel

Cada ruta de servidor es una función de Vercel con los ficheros que traza
`next build`, y todas cuentan contra los 10 GB de Function Storage del plan
gratuito. `scripts/medir-despliegue.mjs` lee ese trazado
(`.next/server/**/*.nft.json`) y escribe un informe con el número de
funciones, los digests distintos, el tamaño de cada una y los paquetes más
pesados. Solo lleva nombres de ruta, de paquete y tamaños.

```bash
npm run build
node scripts/medir-despliegue.mjs --salida informe.json   # sin --salida, a stdout
```

Sin `next build` previo, sale con error. Para comparar un cambio de
empaquetado, mide antes y después con el mismo comando y cambiando una sola
cosa cada vez. La medida es del trazado local: el tamaño real de un
despliegue se confirma en la vista *Resources* de Vercel.

| Medida | Funciones | Digests distintos | Total |
|---|---|---|---|
| Antes (cabeza de `dev`, `908641b`) | 39 | 39 | 127,62 MB |
| Tras `outputFileTracingExcludes` de sharp (musl y WebAssembly) | 39 | 39 | 100,55 MB |
| Tras agrupar las rutas de API en dos despachadores | 18 | 18 | 59,14 MB |

En la medida de referencia, `/api/plan/[id]/infografia.png` pesa 51,14 MB
(todas las variantes de `sharp`/libvips) y el resto de funciones, entre 2 y
3 MB cada una.

`next.config.ts` excluye de todas las rutas las variantes de `sharp` para musl
y WebAssembly (Vercel usa glibc x64): la infografía baja de 51,14 a 24,07 MB.
Si una ruta falla solo en Vercel por un fichero que falta, se revierte
quitando la clave. El número de funciones no cambia con este recorte; lo baja agrupar rutas.

**Rutas de API agrupadas.** Cada `route.ts` se empaqueta como una función
aparte, con el runtime de Next dentro. Por eso los manejadores de API (salvo
`/api/plan`, `/api/plan/[id]` e `infografia.png`, que necesita sus fuentes y
`sharp`) son `manejador.ts` y los reparten dos despachadores:
`src/app/api/[...ruta]/route.ts` y `src/app/api/plan/[id]/[...ruta]/route.ts`,
con una tabla `{ patrón, módulo }` cada uno (`src/lib/api/despachar.ts`).
Las URLs, métodos y códigos no cambian: sin coincidencia responde 404 y, con
el patrón pero sin ese método, 405 con `Allow`. Sesión y permisos siguen dentro
de cada manejador. **Un endpoint nuevo se añade a la tabla del despachador**
(un test falla si un `manejador.ts` no está en ninguna).

El CI falla si el informe supera el presupuesto de
`scripts/comprobar-presupuesto-despliegue.mjs` (20 funciones, 150 MB):
`node scripts/comprobar-presupuesto-despliegue.mjs informe.json`.

## Cómo correr los tests

```bash
npm run lint
npm run typecheck
npm test                     # unitarios (Vitest)
npm run test:integration     # contra la pila local de Supabase (supabase start)
npm run test:e2e             # Playwright: proyectos chromium y movil
npm run verificar:esqueleto  # build + arranque de producción + /api/salud + no-afiliación
npm run comprobar:capturas   # tras los e2e: están todas las capturas de src/test-utils/capturas-esperadas.ts
```

Los de integración y los e2e necesitan la pila local de Supabase levantada
con la CLI de Supabase (`supabase start`, configuración en
`supabase/config.toml`) y las variables `SUPABASE_*` apuntando a ella, como
hace el CI. Las comprobaciones SQL de `scripts/verificar-bd-prueba.sh`
(`relleno`, `cupo`, `permisos`, `lugares`, `obsoleto`, `orden`, `choque`,
`privilegios`) van contra esa misma base con `BD_URL`.

### Ritmo e intereses con el modelo real

`scripts/comprobar-ritmo-intereses.mjs` lee por stdin la salida de
`generar:plan-real` con `--resolver` sobre
`fixtures/criterios-ritmo-intereses.json` (Valencia, 3 días, ritmo
`tranquilo`, intereses museos y parques para niños) y comprueba de forma
determinista que hay como mucho una parada por franja y al menos dos paradas
con un interés marcado. Necesita `claude` en el `PATH`, así que no corre en el
CI:

```bash
npm run --silent generar:plan-real -- --criterios-fichero fixtures/criterios-ritmo-intereses.json --resolver | node scripts/comprobar-ritmo-intereses.mjs
```

### Suite preview (contra un despliegue publicado)

Los ficheros `*.preview.e2e.ts` (`src/verificacion/`) forman el proyecto
`preview` de Playwright, que **solo existe si se define `URL_OBJETIVO`**: no
arranca ni compila la app, va contra un despliegue ya publicado, con un
usuario de pruebas con sesión y un plan real. Nunca corre en el CI ni en
GitHub Actions; el CI comprueba que sin `URL_OBJETIVO` no se lista ningún spec
preview.

```bash
URL_OBJETIVO=https://… CORREO_ACCESO=… CODIGO_ACCESO=… npm run preparar:plan-prueba
URL_OBJETIVO=https://… npx playwright test --project=preview
```

Variables de la suite:

- `URL_OBJETIVO`: el despliegue contra el que se corre.
- `CORREO_ACCESO` y `CODIGO_ACCESO`: el usuario de pruebas y su código de un
  solo uso.
- `CORREO_INVITADO` y `CODIGO_INVITADO`: el segundo usuario de pruebas, el
  invitado de «Compartir» (`src/app/plan/[id]/compartir.preview.e2e.ts`).
  Opcionales: sin ellos esos casos se saltan, no pasan en verde.
- `PLAN_PRUEBA_ID`, `VERCEL_SESION`, `VERIFICACION_DIR` y
  `VERIFICACION_SOLO_ENCOLAR`: opcionales.

Qué hace cada una, tiempos, casos y qué correos están en qué lista en
`docs/verificacion-con-sesion.md`.

### Pruebas a demanda

El workflow «Pruebas a demanda» (`.github/workflows/pruebas-a-demanda.yml`)
se lanza a mano (`workflow_dispatch`) para ejecutar en Actions specs
concretos de una rama. Entradas:

- `tipo`: `e2e` (Playwright contra la pila local de Supabase, como el job e2e
  del CI) o `unit` (Vitest);
- `specs`: ficheros o filtros separados por espacios; vacío ejecuta todos.

Valida las dos entradas antes de usarlas y, si falla un e2e, deja cada test
fallido como anotación del run.

```bash
gh workflow run "Pruebas a demanda" --ref <rama> -f tipo=unit -f specs="src/lib/guia"
```

## Changelog de cambios relevantes

- **2026-10-29** (#378, #379):
  - **Presupuesto del despliegue en el CI** (#378):
    `scripts/comprobar-presupuesto-despliegue.mjs` lee el informe de
    `scripts/medir-despliegue.mjs` y el CI falla si lo supera; reutiliza el
    build de `scripts/verificar-viajes.sh`, sin un segundo build.
  - **Rutas de API agrupadas** (#379): los manejadores pasan a `manejador.ts`
    y los sirven los despachadores `src/app/api/[...ruta]/route.ts` y
    `src/app/api/plan/[id]/[...ruta]/route.ts`; de 39 a 18 funciones y de
    100,55 a 59,14 MB en el trazado local. Las URLs y respuestas no cambian.
    El presupuesto baja a 20 funciones y 150 MB.
- **2026-10-25** (#373):
  - **Reservas en su hora**: la tarjeta fija de una reserva se intercala por
    hora entre las paradas de su franja, en vez de salir la primera.
  - **Arreglos que caben**: «Pasar a…», «Llevar al…» y «Cambiar por…» solo se
    ofrecen si la visita cabe entera en la franja de destino.
  - **Gastos solo en días del viaje**: `PUT /api/plan/[id]/gastos/[gastoId]`
    rechaza con 400 una fecha que no es día del viaje, con el texto del
    formulario.
- **2026-10-20**:
  - **Ritmo e intereses** en el formulario de criterios (#306, #312).
  - **Mapas sin conexión**: «Guardar mapas para usar sin red» (#307, #309).
  - **Sitios propios** con nota (#308, #311, migración 031).
  - **Compartir en solo lectura** (#310, #313, migraciones 032 y 033).
- **2026-10-17**:
  - **Cupo único de peticiones por tick** (#251): antes cada fase del barrido
    tenía su propio tope de 120, así que un tick podía sumar varias veces ese
    número; ahora comparten uno solo (`peticiones_externas` en el resultado
    del tick).
  - **Motivo de las paradas no resueltas** (migración 028): el resolutor
    guarda `resolucion.categoria_motivo` (`sin-candidatos`, `fuera-de-caja`,
    `nombre-distinto`, `tipo-incompatible`), y la función nueva
    `estado_relleno_motivos` suma a `/api/salud.relleno` siete contadores: el
    desglose por motivo, `paradas_con_toponimo` y
    `paradas_sin_intentar_ultima_version`. `estado_relleno` no cambia.
- **2026-10-08**:
  - **Curiosidades** (#207): `MIN_FRASE` baja de 20 a 15, los umbrales entran
    en la huella y `FORMATO_CURIOSIDADES` sube a 6.
  - **Términos y privacidad** (#214): páginas públicas `/terminos` y
    `/privacidad`, enlazadas en el pie, con el aviso de contenido de Google
    Maps y qué datos salen a cada servicio.
  - **Cupo de Google** (#217, migración 026): tablas `topes_google`,
    `consumo_google` y `consumo_google_usuario` y funciones
    `reservar_cupo_google` y `consumo_google_resumen`; bloque `google` en
    `/api/salud`.
  - **Casado del `place_id`** (#219, migración 027 `lugares_google`): el
    trabajador casa las paradas comprobadas con Text Search, con
    `GOOGLE_PLACES_CLAVE`.
  - **Ficha de Google** (#220, #221, #223): panel «Opiniones y horario ·
    Google Maps» en la tarjeta de parada, con
    `NEXT_PUBLIC_GOOGLE_MAPS_CLAVE_NAVEGADOR`.
  - **Aviso de horario** (#222): el horario de OSM dice su fuente y su
    antigüedad y ofrece comprobarlo en la ficha de Google.
  - **Sustitución rápida** (#216, migración 025): `clonar_version_plan` copia
    la última versión de un plan dentro de la base, y las alternativas nacidas
    de una parada sustituida guardan `motivo_parada` y `coste_parada` para
    devolvérselos al deshacer.
  - **Relleno en `/api/salud`** (#205): una sola función SQL por rpc.
  - **Suite preview** (#208, #209, #210, #213, #218): Playwright con sesión
    real contra un despliegue publicado, solo con `URL_OBJETIVO`.
  - **Pruebas a demanda** (#215): workflow manual con entradas `tipo` y
    `specs`.
  - **Origen de salud del trabajador** (#245): el origen con el que el
    trabajador apunta sus filas de salud sale de `SALUD_ORIGEN_TRABAJADOR`
    (por defecto `trabajador`), y `/api/salud` publica el modo de acceso al
    modelo como `suscripcion`.
  - **Fotos de la ficha de Google** (#246): la ficha solo muestra las fotos
    de Google cuando la parada no tiene foto propia.
- **Curiosidades** (#160, #163, #171, #191, #192):
  - frases literales de Wikipedia y Wikidata elegidas por el modelo, que no
    las redacta;
  - formato 5, con huella de reglas y reproceso de lo ya guardado;
  - contador del formato antiguo en `/api/salud`.
- **Vista por días** (#166): resumen, selector de día, un solo mapa y menú de
  opciones.
- **Tarjeta de parada** (#167): compacta, con tres paneles exclusivos.
- **Tarjeta «Ahora»** (#168, #169, #189): siguiente parada del día de hoy,
  hora de salida destacada y nombre accesible por parada.
- **Errores por parada** (#188): el fallo de una parada o de una visita se ve
  en su sitio.
- **Mis viajes** (#165, #190): Próximos y Pasados, orden por fecha, rango
  legible y situación del viaje.
- **Guía de estilo y catálogo de textos** (#165): `docs/guia-de-estilo.md`,
  con comprobación de accesibilidad (axe) en los e2e.
- **Solo `dev` despliega** (#162): las demás ramas no generan preview en
  Vercel.
- **Alternativas con guía** (#158, #159): guardado en bloque, estado visible,
  y la parada nueva hereda la guía de la alternativa.
- **Guía**: consejos completos con «Ver más», curiosidades literales de
  Wikipedia/Wikidata y enlaces de mapa y fuente en cada parada.
- **Tramos del día**: medio, tiempo estimado y enlace entre paradas
  consecutivas, calculados por distancia sin API de rutas.
- **Alternativas**: elegir una alternativa rápida o con su guía, con
  guardado en bloque y estado visible.
- **Infografía**: lámina multiciudad de hasta 7 días, visible dentro del
  plan.
- **Seguridad**: next 16.3.6 (CVE-2026-94545); licencias solo por https;
  `/api/salud` sin texto crudo de errores.
- **Mis viajes**: lista, eliminar y pedir otro viaje; regenerar un plan
  existente.
