# Guía de estilo de los textos

Reglas para todo texto que ve quien usa la aplicación. Adaptadas de la guía
de GOV.UK para escribir interfaces y de la de lenguaje claro de la ONS. Los
textos viven en `src/lib/textos/` y un test los recorre contra estas reglas.

## Principios

- Escribe para quien está en el móvil, de pie y con prisa: una idea por frase.
- Di lo que el usuario puede hacer o necesita saber, no cómo funciona por dentro.
- Nada de describir lo evidente: si el botón ya dice «Cerrar sesión», no hace falta una ayuda que lo repita.
- Un aviso se explica una sola vez, en un sitio fijo. Después, marcas breves y siempre las mismas.
- Tuteo, tono directo, sin «por favor» ni exclamaciones.

## Botones y enlaces

- Un botón empieza por un verbo en infinitivo («Reintentar», «Cerrar sesión») o en imperativo de tú si es una invitación («Cuéntanos tu viaje»).
- Un enlace dice a dónde lleva («Ver el itinerario»), nunca «aquí» ni «haz clic».
- Máximo 40 caracteres. El estilo de una acción destructiva va aparte del de la principal.

## Encabezados

- Ponen la tarea o el contenido delante: «Próximos», «Pasados», «Día 3 · mié 16 oct».
- Un solo h1 por pantalla y sin saltos de nivel.

## Avisos y procedencia

- Lo que no está comprobado se dice con «Sin comprobar» y se ve siempre, sin plegar.
- Un tiempo estimado lleva «≈». La explicación se da una vez, en «Cómo leer este plan».
- Los textos de Wikipedia, Wikidata y Wikivoyage se citan con su atribución y su enlace.
- Un horario de OpenStreetMap dice de dónde sale y cuándo se comprobó («Horario según OpenStreetMap · comprobado en 2023» o «sin fecha de comprobación»). Sus avisos hablan de lo que «puede» pasar y nombran la fuente, nunca afirman que algo está cerrado. Con más de dos años, sin fecha o con aviso de cierre, la parada casada con Google ofrece «Compruébalo en Google».

## Errores y estados vacíos

- Un error dice qué pasó y qué hacer: «No se ha podido cargar tu lista de viajes. Vuelve a intentarlo en un momento.» Si se puede, ofrece un botón para reintentar.
- No se culpa al usuario ni se promete lo que no existe (papelera, recuperación).
- Una lista sin datos nunca se queda muda: explica por qué y ofrece el siguiente paso.
- Las ayudas y los errores no pasan de 140 caracteres.
- El error de una acción lleva la clase `.mensaje-error` (borde izquierdo de 3 px en `--peligro-borde`, texto en `--peligro-texto` a tamaño base), nunca `.ayuda`. Solo una región `role="alert"` lo anuncia; si el mismo texto se repite en otra tarjeta, esa copia va con `aria-hidden="true"`.

## Números, fechas y horas

- Punto de miles siempre, también en cuatro cifras: «3.000 €», «12.345 €». Los años no llevan separador: «1857».
- Espacio duro (U+00A0) entre la cifra y «€», para que el símbolo no quede solo en una línea.
- Fechas en castellano con día de la semana: «mié 16 oct». Nunca la fecha ISO a la vista.
- Horas locales del destino, en 24 horas: «11:15».
- Todo importe pasa por `src/lib/formato/numeros.ts`.
- Los rangos de viaje («3–5 oct 2026», «28 sept – 2 oct 2026») salen de una tabla propia de meses en `src/lib/viajes/presentar.ts`, no de `Intl.DateTimeFormat.formatRange`: así el texto es idéntico en servidor y navegador y septiembre es «sept». El test `src/lib/viajes/__tests__/presentar.test.ts` lo fija; se vuelve a `formatRange` si ambos entornos comparten ICU y da «sept».
