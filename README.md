# Hexfortia

Juego táctico 2D para dos jugadores en tablero hexagonal. La interfaz utiliza React, TypeScript estricto y Vite; el tablero se representa con PixiJS 8 (WebGL, con respaldo Canvas). Las reglas se describen en `docs/especificacion_juego_hexagonal.md`.

Los ejércitos están formados por máquinas controladas a distancia por humanos o por
Hexfortia. Los [diseños oficiales de las nueve unidades](assets/units/README.md)
pueden consultarse también en el manual del juego.

## Ejecutar

El gestor de paquetes del proyecto es **pnpm**. La versión está fijada en el campo `packageManager` de `package.json`; las instrucciones para trabajar en el repositorio están en [AGENTS.md](AGENTS.md).

```bash
pnpm install
pnpm dev
```

Build de producción:

```bash
pnpm build
pnpm preview
```

## Verificar

```bash
pnpm test:types
pnpm lint
pnpm test
pnpm test:coverage
pnpm test:design-system
pnpm test:ui
pnpm test:a11y
pnpm test:online
pnpm test:vercel
pnpm test:tutorial
pnpm exec node scripts/progression-smoke.mjs
```

`pnpm test:types` comprueba todos los archivos TypeScript y TSX del proyecto, incluidos el código, las pruebas y la configuración, sin generar archivos. También se ejecuta al hacer el build.

`pnpm test` valida geometría, reglas, configuración, invariantes, replay y la sesión que conecta el juego con React. La cobertura tiene umbrales específicos del dominio. Las pruebas de UI y Axe usan Edge o Chrome; puede indicarse otro navegador con `PLAYWRIGHT_BROWSER_PATH`.

Tras `pnpm build`, `pnpm test:offline` comprueba la recarga y la primera apertura de los diálogos y selectores sin conexión. Vite genera la precarga de todos los recursos de producción para que los diálogos puedan cargarse bajo demanda también offline.

El [laboratorio de IA neuronal](docs/ia-neuronal.md) permite generar posiciones, entrenar un
evaluador pequeño en CPU, comprobarlo en el navegador y enfrentarlo a Experto con partidas
emparejadas. «Neuronal» carga el candidato experimental; los cuatro niveles clásicos conservan
su evaluación anterior.

`pnpm ai:selfplay --publish` automatiza autojuego, entrenamiento y evaluación contra el campeón
y Experto. Solo instala candidatos que superen los filtros y la comprobación del navegador.
Permite reanudar y conserva modelos anteriores; una ronda completa puede durar más de un día.
Consulta [el funcionamiento y los comandos de autojuego](docs/ia-autojuego.md).

## Arquitectura

La aplicación conserva sus modos locales como SPA y añade una API Node/Fastify para el multijugador, con Supabase Auth y PostgreSQL. La interfaz y la API se despliegan juntas en el mismo proyecto Vercel mediante las funciones de `api/` y `vercel.json`. React organiza las pantallas, los paneles y los diálogos. `GameSession` coordina la partida, la IA, las preferencias, el autoguardado y las repeticiones; los componentes leen su snapshot mediante `useSyncExternalStore` y ejecutan comandos sobre esa sesión. La [guía de multijugador](docs/multijugador.md) explica la arquitectura, la migración y la configuración del servidor.

El motor de reglas sigue siendo TypeScript independiente de React, el DOM y el almacenamiento. PixiJS conserva la cámara, los glifos y las animaciones: `BoardCanvas` gestiona el renderer y sus eventos, mientras React se ocupa de la interfaz y su representación accesible. Los efectos liberan listeners, temporizadores y recursos gráficos al desmontarse.

La escena utiliza objetos persistentes de PixiJS y renderizado bajo demanda: no mantiene un bucle continuo cuando no hay animaciones ni marcas pulsantes. La inicialización gráfica es asíncrona y respeta el desmontaje de React, las preferencias de movimiento reducido y las animaciones idle opcionales. Se utiliza WebGL cuando está disponible y el renderizador Canvas de PixiJS como respaldo; si ninguno puede iniciarse, la interfaz muestra un aviso.

Los controles comunes utilizan Tailwind CSS 4, integrado con `@tailwindcss/vite`, y los tokens visuales existentes. `src/styles.css` organiza las capas y expone esos tokens con `@theme inline`; `src/styles/tokens.css` conserva los valores del tema y `src/styles/game.css` contiene los estilos específicos del juego. No se carga Preflight, para conservar la base visual actual. El tablero, las animaciones y los estilos específicos siguen utilizando CSS propio; no se ha convertido cada regla existente en utilidades.

Los selectores comparten `GameSelect`, basado en React Select con `unstyled` y `classNames` de Tailwind. Sus listas cortas no ofrecen búsqueda ni borrado del valor, mantienen etiquetas y mensajes en español y muestran el foco. Dentro de un diálogo, el menú se monta en el propio diálogo para conservar la interacción modal y evitar recortes.

El [sistema de diseño](docs/design-system.md) reúne botones, campos, validación y controles compuestos con Radix UI en `src/app/components/ui/`. Los componentes son independientes de la sesión de juego y comparten tokens, foco y preferencias de accesibilidad. Con `pnpm dev`, el [catálogo de desarrollo](http://localhost:5173/design-system.html) permite probar sus estados e interacciones; no se incluye como entrada del build de producción. `pnpm test:design-system` comprueba el catálogo en navegador.

**Batalla en línea** abre Buscar partida y Partida privada. La búsqueda pública se inicia con un clic: bando aleatorio, Fortaleza de 1 vida, turnos de 30 segundos, tiempo total sin límite y Frente clásico. Las privadas permiten personalizar las reglas. Para emparejar y jugar entre dispositivos hay que activar el servidor y Supabase siguiendo la [guía](docs/multijugador.md). El formato de guardados locales se conserva.

## Modos y datos

Puedes jugar como **invitado**, guardando en este navegador, o crear una **cuenta** para sincronizar
perfil, progreso, preferencias, historial y partidas pendientes en Supabase. «Batalla en línea»
requiere una cuenta y abre el acceso o registro cuando juega un invitado. El registro ofrece importar el
progreso local sin borrar su copia. La [guía de cuentas](docs/cuentas.md) explica la nueva migración,
la configuración de correo y la resolución de conflictos entre dispositivos.

- **Partida libre:** local o contra IA. Contra la IA puedes elegir la dificultad: Fácil, Medio, Difícil, Experto o Neuronal. Los niveles superiores dedican más tiempo a anticipar respuestas; mantienen el mismo presupuesto de búsqueda en escritorio y móvil. Neuronal ejecuta una red pequeña en el navegador; Experto conserva su evaluación clásica.
- **Puntos de vida de la Fortaleza:** elige 1, 2 o 3 al crear cualquier partida libre; la opción predeterminada es 1.
- **Tiempo:** configura por separado el tiempo por turno (Sin límite, 30 segundos, 60 segundos o 90 segundos) y el tiempo total por jugador (Sin límite, 5 minutos, 10 minutos o 20 minutos). Puedes combinar ambos límites. Al agotar el tiempo de turno, la IA realiza una jugada por ti; la tercera vez que un mismo jugador lo agota durante la partida, pierde. Agotar el tiempo total concede la victoria al rival. El tiempo por turno se reinicia al comenzar cada turno y el total solo se consume mientras juega ese bando. Los relojes y las veces que cada jugador ha agotado el tiempo de turno se conservan al guardar y continuar.
- **Disposiciones iniciales:** Frente clásico (antes Frente blindado: 5 asaltadores, 4 tanques y 18 piezas por jugador) y Frente extendido (11 asaltadores, 2 tanques retrasados y 22 piezas por jugador). Ambas incluyen un lanzamisiles y un caza. Los guardados con formaciones anteriores siguen siendo compatibles.
- Al elegir una disposición, la vista previa muestra el ejército de Cian con los símbolos del tablero, su composición y una breve descripción. Se actualiza también al cambiar la vida de la Fortaleza; Ámbar utiliza la formación reflejada.
- En **Reglas → Desarrollo de la partida**, el tablero real muestra ambos ejércitos y permite comparar las dos disposiciones, con **Frente clásico** seleccionado por defecto. El selector solo cambia la vista del manual.
- **Tutorial:** una bienvenida, 14 apartados y 42 pasos sobre el tablero, con objetivos señalados, órdenes restringidas y respuestas enemigas programadas. Anterior y Siguiente cambian de apartado; los ejercicios avanzan al realizarlos. Termina con una práctica libre en la que solo juega Cian hasta destruir la Fortaleza enemiga. Las flechas blancas indican casillas o botones del panel de mando y priorizan trayectorias diagonales libres de unidades y marcadores. Entrar o salir del tutorial conserva la partida guardada.
- Autoguardado después de cada orden y al abandonar una partida. «Continuar partida» permite elegir entre las partidas pendientes; iniciar otra no borra las anteriores. Tras más de 30 días sin retomarse, una partida se registra como perdida en el historial y deja de aparecer entre las pendientes. En partidas locales, pierde el jugador que tenía el turno; contra la IA, pierde el jugador humano. La caducidad se comprueba al consultar o retomar las partidas.
- El perfil abre Tu perfil, Estadísticas y récords y Configuración. Incluye XP, logros, racha, Elo, resultados y récords. Las posiciones compartidas están pendientes; el Elo en línea se sincroniza con el servidor al jugar partidas públicas.
- En partidas nuevas se elige Expansionista (cian) o Conservacionista (violeta). El marcador identifica al usuario y a Hexfortia o al Invitado. El primer turno se sortea visiblemente antes de activar el reloj y la IA. Hexfortia se juega siempre sin límite de tiempo.
- El progreso empieza en nivel 0; mantiene los incrementos de XP de 125, 150, 175… Los logros Principiante, Avanzado y Experto otorgan 25, 75 y 200 XP. Contra Hexfortia, victoria / derrota o tablas: Fácil 25 / 15, Medio 50 / 25, Difícil 75 / 35, Experto 100 / 50. Las bonificaciones de duración y primera partida diaria se mantienen.
- Ajustes y Configuración del perfil aplican los cambios con «Guardar cambios»; la X los descarta. Ajustes ofrece Exportar partida, Importar partida e Historial de resultados; la repetición se abre desde el tablero.
- El visor de repetición permite recorrer la partida sin modificarla.
- PWA instalable con caché offline del shell.

Los guardados declaran versión y ruleset. Una repetición importada se reconstruye acción por acción y se rechaza si contiene una orden ilegal. El desenlace terminal también forma parte del registro: victoria por Fortaleza, tiempo o rendición, por cinco turnos de orientación, y tablas por bloqueo sobreviven al autoguardado, la exportación y la reproducción.

Cada partida contra la IA y cada revancha generan una semilla nueva. Los niveles clásicos, incluido Experto, pueden elegir entre órdenes de valoración muy próxima; el margen se estrecha al subir la dificultad y se respetan las victorias forzadas y su distancia. Neuronal elige la orden mejor valorada por su búsqueda. Si una jugada es claramente superior, puede repetirse aunque cambie la semilla. Continuar o importar una partida conserva su semilla, y las repeticiones reproducen las acciones registradas.

Los presupuestos máximos de cálculo por turno son: Fácil, 0,25 segundos; Medio, 2 segundos; Difícil, 5 segundos; Experto y Neuronal, 15 segundos. Buscan hasta 1, 3, 5 y 9 medias jugadas respectivamente, con extensiones para resolver intercambios y amenazas a la Fortaleza. Todos los niveles, incluido Fácil, utilizan búsqueda en un Worker y pueden responder antes si terminan el análisis. Solo se utilizan iteraciones terminadas: la profundidad efectiva depende de la posición y del dispositivo. Si el Worker no está disponible, el respaldo limita su tiempo para mantener la respuesta de la interfaz. Si los pesos neuronales no se pueden cargar, se avisa y Experto juega ese turno. Una semilla explícita permite repetir las decisiones con el mismo estado y profundidad completada; no garantiza que equipos distintos alcancen la misma profundidad dentro del límite de tiempo.

Neuronal comparte provisionalmente las recompensas y la valoración de juego de Experto. Los resultados de sus ensayos se documentan en [las iteraciones del laboratorio](docs/ia-neuronal-iteraciones.md).

La IA valora la conservación del Embestidor y del Caza, el coste de transformar vehículos y las recapturas inmediatas, también al elegir una jugada de respaldo por falta de tiempo. Para el Caza, considera las salidas legales sin intercepción durante todo el trayecto, los corredores ocupados y la continuidad de dos vuelos. Es una estimación de movilidad; la búsqueda sigue resolviendo las respuestas enemigas con el motor. Las [pruebas estratégicas y ensayos de desarrollo](docs/ia-estrategia-2026-10-20.md) documentan los cambios y sus límites.

## Logros

El menú **Logros**, disponible desde el inicio y durante la partida, reúne 23 desafíos con iconos cuadrados, descripción de sus condiciones, progreso acumulado y fecha de desbloqueo. Permite filtrar todos, pendientes o desbloqueados. Incluye victorias contra cada dificultad de IA, partidas entre humanos, relojes de 5, 10 y 20 minutos por bando, hazañas como remontar con la Fortaleza a un punto o dejar al rival sin piezas.

Los logros pertenecen al perfil del invitado o de la cuenta activa: en partidas entre humanos cuentan ambos bandos; contra la IA solo cuentan las acciones y victorias del humano. Las capturas, conversiones, intercepciones y transformaciones suman y desbloquean logros en cuanto se ejecuta la acción, aunque después se abandone la partida. Los objetivos de partidas y victorias requieren terminar y haber jugado al menos una orden; Repeticiones, partidas importadas y la demostración de portada no suman logros de partida. Deshacer no revoca un logro obtenido y rehacer no duplica el progreso. Los datos de la antigua Academia se conservan por compatibilidad, pero su catálogo y sus logros ya no aparecen en la interfaz.

Cada desbloqueo muestra únicamente su icono y título, acompañado de una campanilla que respeta el silencio y los volúmenes maestro y de efectos. Si se consiguen varios, los avisos aparecen uno a uno; se posponen mientras la pestaña está oculta. Los logros se guardan por separado de las partidas y permanecen al iniciar otra. Como invitado, borrar los datos del navegador elimina la colección; con cuenta, los cambios sincronizados se recuperan desde Supabase.

## Reglas canónicas (`classic-v2`)

- El Lanzamisiles dispone de dos misiles por partida. Cada disparo consume uno; cambiar de bando no repone la munición. Agotados los misiles, conserva el movimiento y la transformación en Asaltador.
- La Fortaleza puede comenzar con 1, 2 o 3 puntos de vida, según la configuración. Cada impacto siempre causa exactamente 1 punto de daño.
- Asaltador, Capturador y Embestidor se sacrifican después de impactar contra la Fortaleza. Tanque, Lanzamisiles, Dron y Caza sobreviven si no usan un ataque kamikaze; el Caza kamikaze se destruye por su propia regla.
- Cada casilla admite una capa terrestre y una aérea, con una unidad como máximo en cada capa. Al atacar una casilla compartida se elige un único objetivo.
- El Escudo antiaéreo protege su propia casilla y las seis adyacentes. Las aeronaves enemigas que entran o cruzan esa zona son interceptadas en la primera casilla protegida. Tanque y Lanzamisiles no pueden disparar por una trayectoria protegida; el Caza no puede disparar contra una casilla protegida.
- Tanque, Lanzamisiles y Embestidor pueden transformarse en Asaltador. La orientación elegida y el posible avance o ataque inmediato del Asaltador forman una sola orden.
- Un jugador pierde tras cinco turnos propios consecutivos dedicados únicamente a orientar asaltadores o cañones de tanques. Cualquier otra acción reinicia su contador. Antes de confirmar el quinto cambio, una advertencia permite cancelar o confirmar la derrota. No hay tablas automáticas por repetición ni por 120 medias jugadas.
- Si un jugador no tiene acciones legales, el turno pasa. Si ninguno de los dos bandos puede destruir la Fortaleza rival, hay tablas por bloqueo; los jugadores también pueden acordar ese resultado.

## Controles

- Ratón o táctil: seleccionar unidad, elegir marcador y confirmar orden.
- En escritorio, el panel de mando es una ventana flotante a la derecha, que no desplaza el tablero. Arrastra la cabecera para moverla o enfócala y usa las flechas (Mayús acelera el movimiento). «−» la minimiza abajo y Restaurar recupera su posición y orden pendiente. «×» cierra y deselecciona; la siguiente selección abre la ventana en su posición inicial.
- En pantallas estrechas, el panel sigue integrado junto al tablero o debajo; puedes desplazarte para consultar las órdenes. «×» también permite cerrarlo.
- Cancelar aparece junto a Confirmar acción y descarta la orden preparada manteniendo la unidad seleccionada y el panel abierto. Pulsar la unidad seleccionada o una casilla vacía sin orden legal tampoco cierra el panel; usa «×» para cerrarlo.
- El botón de registro de batalla abre o cierra su ventana sin cambiar la selección ni la orden preparada. Puede verse junto al panel de mando; en escritorio, ambas ventanas se pueden mover, minimizar y restaurar de forma independiente.
- Cambiar orientación y Orientar cañón abren la brújula. El movimiento del tanque permite elegir la orientación final del cañón antes de confirmar, también en modo Rápida.
- Al convertir un vehículo en Asaltador, elige la orientación y, si quieres avanzar o atacar como Asaltador ese mismo turno, selecciona el destino antes de confirmar.
- La cabecera permite rendirse, proponer tablas en partidas locales y abandonar la partida, siempre con confirmación. Abandonar descarta la partida en curso y vuelve al inicio.
- Pantalla completa está disponible en todas las pantallas y diálogos.
- Arrastrar: desplazar cámara.
- Rueda o pinza: zoom.
- Flechas de deshacer y rehacer junto al zoom: retroceder o recuperar órdenes en partidas locales de dos jugadores. Puedes volver varios pasos atrás; una orden nueva sustituye la continuación deshecha. El reloj conserva el tiempo consumido.
- `Q W E` y `A S D`: las seis direcciones hexagonales.
- `7 8 9 4 2 6`: alternativa con teclado numérico.
- `Enter`: seleccionar casilla enfocada.
- `Esc`: cancelar la orden o maniobra en preparación sin cerrar el panel.
- `U`/`Mayús+U`: recorrer unidades propias.
- `H`, `L`, `C`: reglas, registro y centrar tablero.

## Estructura

- `src/engine.ts`: reglas puras, turnos, combate y finales.
- `src/classic-rules.ts`: constantes canónicas de daño, sacrificio, repetición y falta de progreso.
- `src/game-config.ts`: configuración validada y contrato `classic-v2`.
- `src/match-presets.ts`: compatibilidad con las configuraciones predefinidas anteriores.
- `src/match-record.ts`: diario versionado, replay y estadísticas.
- `src/match-clock.ts`: reloj persistente y desenlace por tiempo.
- `src/action-identity.ts` y `src/tactical-analysis.ts`: identidad canónica y consulta táctica pura.
- `src/match-store.ts` y `src/match-controller.ts`: estado de partida, validación de órdenes e historial de deshacer/rehacer.
- `src/app/contracts.ts` y `src/app/game-session.ts`: contrato de snapshots y comandos; coordinación de partida, IA, reloj, preferencias y persistencia.
- `src/app/game-context.tsx`: contexto de sesión y suscripción de los componentes React.
- `src/app/app.tsx`, `src/app/panels.tsx` y `src/app/dialogs/`: pantallas, paneles, configuración, manual y diálogos en React.
- `src/app/components/game-select.tsx`: selector compartido con React Select, accesibilidad y estilos mediante Tailwind.
- `src/app/components/ui/` y `docs/design-system.md`: controles reutilizables, contratos de composición y guía del sistema de diseño.
- `src/app/board-canvas.tsx`: ciclo de vida del renderer e interacción con el tablero.
- `src/styles.css`, `src/styles/tokens.css` y `src/styles/game.css`: entrada y capas de Tailwind, tokens visuales y CSS específico del juego.
- `src/scenarios.ts`: evaluación de objetivos y compatibilidad de escenarios antiguos y personalizados.
- `src/ai-strategy.ts` y `src/ai-worker.ts`: estrategias con presupuesto y cancelación.
- `src/match-storage.ts`: preferencias, autoguardado y progreso local.
- `src/progression.ts` y `src/progression-catalog.ts`: XP, 100 niveles, 100 logros, rachas y Elo del perfil local.
- `src/achievements.ts`: compatibilidad con los logros y guardados de la versión anterior.
- `src/hex.ts`: coordenadas axiales y conversión a posiciones visuales.
- `src/renderer.ts`: cámara, interacción y planificación de animaciones.
- `src/rendering/`: escena PixiJS, piezas y marcas tácticas reutilizables, contexto gráfico y modelos visuales puros.
- `src/audio.ts`: paisajes sonoros sintetizados con Web Audio.
- `src/main.tsx`: entrada de React, estilos y registro de la PWA.
- `src/service-worker.js`: plantilla de la caché offline, emitida como `sw.js` con todos los recursos del build.
- `vite.config.ts`: integración de React y Tailwind CSS 4 con Vite y generación de la precarga offline.
- `tests/engine.test.ts`: pruebas de reglas y casos límite.
- `tests/game-session.test.ts`: continuidad de guardados, comandos, replay, preferencias y cancelación de tareas al cambiar o desmontar la sesión.

La auditoría técnica y el siguiente orden de evolución están en `docs/auditoria-mejoras-2026.md`.

No usa recursos gráficos o sonoros externos. Logotipo, fichas, efectos y audio se generan localmente.

## Experiencia, logros y clasificación

El perfil empieza en nivel 1 con 0 XP y 1000 puntos Elo. Cada salto de nivel cuesta
`100 + 25 × nivel actual` XP. Las categorías Principiante, Avanzado, Experto, Maestro y
Legendario se abren en los niveles 1, 5, 15, 30 y 50. Sus logros conceden 50, 100, 250,
500 y 1000 XP respectivamente. Cada categoría tiene 15 logros visibles y 5 ocultos:
los ocultos muestran solo el título hasta conseguirse. Al abrir una categoría se evalúan
también las acciones y partidas anteriores que cumplan su modalidad y dificultad.

Contra Hexfortia, una victoria concede 50/75/100/150 XP según dificultad; las derrotas
y tablas, 25/35/50/75. Terminar cualquier partida concede hasta 50 XP por duración
(1 XP por cada dos turnos consumidos); en local esta es la única recompensa de partida.
La primera partida terminada del día suma 25 XP. Rendirse cuenta incluso sin órdenes;
una partida en curso o abandonada no concede XP de partida. Las hazañas tácticas ya
realizadas se conservan. En local el perfil pertenece a Cian; Ámbar es el invitado.
La racha de actividad cuenta visitas en días naturales consecutivos, sin exigir partidas.

La clasificación contra Hexfortia usa Elo con rivales equivalentes a 600/1000/1400/1800
puntos. El factor K es 40/32/24/20/16 para 0–9/10–24/25–49/50–99/100 o más partidas.
La puntuación se redondea a enteros y nunca baja de cero. La vista mensual recalcula
desde 1000 con los últimos 30 días naturales, incluido hoy. Solo aparece el perfil de
este navegador: las partidas en línea y las posiciones TOP mundiales necesitan una
modalidad conectada y una clasificación compartida que este proyecto todavía no tiene.
Sus logros permanecen pendientes; no se asignan posiciones ficticias. Las partidas
locales no tienen Elo. Importaciones, reproducciones y deshacer/rehacer no duplican premios.

Los datos se guardan en `hexagonal:progression:v1`. Los logros anteriores se conservan
en un apartado de legado; sus contadores compartidos no se convierten en victorias
personales ni se les atribuye una dificultad desconocida. Los guardados de partidas
mantienen su formato existente.

La fórmula de XP prevalece sobre la tabla ilustrativa del documento original, cuyos
totales posteriores al nivel 10 no son consistentes: alcanzar el nivel 100 requiere
133.650 XP según esa fórmula. Los siete tipos que cuentan para los logros de uso y
combate son Asaltador, Capturador, Tanque, Lanzamisiles, Embestidor, Dron y Caza.
