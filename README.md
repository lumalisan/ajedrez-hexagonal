# Protocolo Hexagonal

Juego táctico 2D para dos jugadores en tablero hexagonal. La interfaz utiliza React, TypeScript estricto y Vite; el tablero se representa con PixiJS 8 (WebGL, con respaldo Canvas). Las reglas se describen en `docs/especificacion_juego_hexagonal.md`.

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
```

`pnpm test:types` comprueba todos los archivos TypeScript y TSX del proyecto, incluidos el código, las pruebas y la configuración, sin generar archivos. También se ejecuta al hacer el build.

`pnpm test` valida geometría, reglas, configuración, invariantes, replay y la sesión que conecta el juego con React. La cobertura tiene umbrales específicos del dominio. Las pruebas de UI y Axe usan Edge o Chrome; puede indicarse otro navegador con `PLAYWRIGHT_BROWSER_PATH`.

Tras `pnpm build`, `pnpm test:offline` comprueba la recarga y la primera apertura de los diálogos y selectores sin conexión. Vite genera la precarga de todos los recursos de producción para que los diálogos puedan cargarse bajo demanda también offline.

## Arquitectura

La aplicación es una SPA local, sin backend. React organiza las pantallas, los paneles y los diálogos. `GameSession` coordina la partida, la IA, las preferencias, el autoguardado y las repeticiones; los componentes leen su snapshot mediante `useSyncExternalStore` y ejecutan comandos sobre esa sesión.

El motor de reglas sigue siendo TypeScript independiente de React, el DOM y el almacenamiento. PixiJS conserva la cámara, los glifos y las animaciones: `BoardCanvas` gestiona el renderer y sus eventos, mientras React se ocupa de la interfaz y su representación accesible. Los efectos liberan listeners, temporizadores y recursos gráficos al desmontarse.

La escena utiliza objetos persistentes de PixiJS y renderizado bajo demanda: no mantiene un bucle continuo cuando no hay animaciones ni marcas pulsantes. La inicialización gráfica es asíncrona y respeta el desmontaje de React, las preferencias de movimiento reducido y las animaciones idle opcionales. Se utiliza WebGL cuando está disponible y el renderizador Canvas de PixiJS como respaldo; si ninguno puede iniciarse, la interfaz muestra un aviso.

Los controles comunes utilizan Tailwind CSS 4, integrado con `@tailwindcss/vite`, y los tokens visuales existentes. `src/styles.css` organiza las capas y expone esos tokens con `@theme inline`; `src/styles/tokens.css` conserva los valores del tema y `src/styles/game.css` contiene los estilos específicos del juego. No se carga Preflight, para conservar la base visual actual. El tablero, las animaciones y los estilos específicos siguen utilizando CSS propio; no se ha convertido cada regla existente en utilidades.

Los selectores comparten `GameSelect`, basado en React Select con `unstyled` y `classNames` de Tailwind. Sus listas cortas no ofrecen búsqueda ni borrado del valor, mantienen etiquetas y mensajes en español y muestran el foco. Dentro de un diálogo, el menú se monta en el propio diálogo para conservar la interacción modal y evitar recortes.

El [sistema de diseño](docs/design-system.md) reúne botones, campos, validación y controles compuestos con Radix UI en `src/app/components/ui/`. Los componentes son independientes de la sesión de juego y comparten tokens, foco y preferencias de accesibilidad. Con `pnpm dev`, el [catálogo de desarrollo](http://localhost:5173/design-system.html) permite probar sus estados e interacciones; no se incluye como entrada del build de producción. `pnpm test:design-system` comprueba el catálogo en navegador.

La API y el multijugador online quedan para una etapa posterior. Esta migración no añade Nitro ni cambia el formato de guardados.

## Modos y datos

- **Partida libre:** local o contra IA con un único selector de dificultad: Fácil, Media, Difícil y Experto. Los niveles superiores dedican más tiempo a anticipar respuestas; mantienen el mismo presupuesto de búsqueda en escritorio y móvil.
- **Presets:** Escaramuza, Táctica, Asedio y configuración Personalizada. Ajustan despliegue, ritmo e integridad inicial sin alterar el movimiento ni el combate de las unidades.
- **Disposiciones iniciales:** en Nueva partida → Personalizada puedes elegir Frente clásico, Columnas de asedio, Frente blindado (5 soldados y 4 tanques), Frente de infantería (7 soldados y 2 tanques) o Frente extendido (11 soldados y 2 tanques retrasados). Las cuatro primeras tienen 18 piezas por jugador; Frente extendido tiene 22. Las variantes blindada, de infantería y extendida tienen un lanzamisiles a la izquierda y un avión a la derecha de la Fortaleza, vistos desde cada bando. Disponibles en partida local y contra la IA.
- Al elegir una disposición, la vista previa muestra el ejército de Cian con los símbolos del tablero, su composición y una breve descripción. Se actualiza también al cambiar la vida de la Fortaleza; Ámbar utiliza la formación reflejada.
- En **Reglas → Desarrollo de la partida**, el tablero real muestra ambos ejércitos y permite comparar las cinco disposiciones, con **Frente clásico** seleccionado por defecto. El selector solo cambia la vista del manual.
- **Academia táctica:** fundamentos, misión guiada de varios turnos, retos estratégicos y un reto diario determinista que usan `classic-v2`.
- Autoguardado después de cada orden y continuación desde el inicio. Ajustes ofrece directamente Exportar partida, Importar partida, Ver repetición e Historial de resultados.
- El visor de repetición permite recorrer la partida sin modificarla.
- PWA instalable con caché offline del shell.

Los guardados declaran versión y ruleset. Una repetición importada se reconstruye acción por acción y se rechaza si contiene una orden ilegal. El desenlace terminal también forma parte del registro: victoria por Fortaleza, tiempo o rendición, y tablas por bloqueo, repetición o falta de progreso sobreviven al autoguardado, la exportación y la reproducción.

## Logros

El menú **Logros**, disponible desde el inicio y durante la partida, reúne 28 desafíos con iconos cuadrados, descripción de sus condiciones, progreso acumulado y fecha de desbloqueo. Permite filtrar todos, pendientes o desbloqueados. Incluye victorias contra cada dificultad de IA, partidas entre humanos, relojes de 5, 10 y 20 minutos por bando, Academia, retos diarios y hazañas como remontar con la Fortaleza a un punto o dejar al rival sin piezas.

Los logros pertenecen al perfil local de este navegador: en partidas entre humanos cuentan ambos bandos; contra la IA solo cuentan las acciones y victorias del humano. Las capturas, conversiones, intercepciones y transformaciones suman y desbloquean logros en cuanto se ejecuta la acción, aunque después se abandone la partida. Los objetivos de partidas y victorias requieren terminar y haber jugado al menos una orden; los de Academia se consiguen al superar la lección. Repeticiones, partidas importadas y la demostración de portada no suman logros de partida. Deshacer no revoca un logro obtenido y rehacer no duplica el progreso. El progreso de Academia ya guardado se reconoce al iniciar, sin repetir avisos antiguos.

Cada desbloqueo muestra únicamente su icono y título, acompañado de una campanilla que respeta el silencio y los volúmenes maestro y de efectos. Si se consiguen varios, los avisos aparecen uno a uno; se posponen mientras la pestaña está oculta. Los logros se guardan por separado de las partidas y permanecen al iniciar otra, pero borrar los datos del navegador elimina la colección.

## Reglas canónicas (`classic-v2`)

- El Lanzamisiles dispone de dos misiles por partida. Cada disparo consume uno; cambiar de bando no repone la munición. Agotados los misiles, conserva el movimiento y la transformación en Soldado.
- La Fortaleza puede comenzar con 1, 2 o 3 puntos de vida, según el preset o la configuración. Cada impacto siempre causa exactamente 1 punto de daño.
- Soldado, Capturador y Embestidor se sacrifican después de impactar contra la Fortaleza. Tanque, Lanzamisiles, Dron y Avión sobreviven si no usan un ataque kamikaze; el Avión kamikaze se destruye por su propia regla.
- Cada casilla admite una capa terrestre y una aérea, con una unidad como máximo en cada capa. Al atacar una casilla compartida se elige un único objetivo.
- El Escudo antiaéreo protege su propia casilla y las seis adyacentes. Las aeronaves enemigas que entran o cruzan esa zona son interceptadas en la primera casilla protegida. Tanque y Lanzamisiles no pueden disparar por una trayectoria protegida; el Avión no puede disparar contra una casilla protegida.
- Tanque, Lanzamisiles y Embestidor pueden transformarse en Soldado. La orientación elegida y el posible avance o ataque inmediato del Soldado forman una sola orden.
- La tercera aparición de la misma posición, con el mismo jugador al turno, produce tablas. La configuración estándar también declara tablas tras 120 medias jugadas (`plies`) sin bajas, intercepciones ni daño a Fortaleza; el límite efectivo queda guardado en cada partida.
- Si un jugador no tiene acciones legales, el turno pasa. Si ninguno de los dos bandos puede destruir la Fortaleza rival, hay tablas por bloqueo; los jugadores también pueden acordar ese resultado.

## Controles

- Ratón o táctil: seleccionar unidad, elegir marcador y confirmar orden.
- En escritorio, el panel de mando es una ventana flotante a la derecha, que no desplaza el tablero. Arrastra la cabecera para moverla o enfócala y usa las flechas (Mayús acelera el movimiento). «−» la minimiza abajo y Restaurar recupera su posición y orden pendiente. «×» cierra y deselecciona; la siguiente selección abre la ventana en su posición inicial.
- En pantallas estrechas, el panel sigue integrado junto al tablero o debajo; puedes desplazarte para consultar las órdenes. «×» también permite cerrarlo.
- Cancelar aparece junto a Confirmar acción y descarta la orden preparada manteniendo la unidad seleccionada y el panel abierto. Pulsar la unidad seleccionada o una casilla vacía sin orden legal tampoco cierra el panel; usa «×» para cerrarlo.
- El botón de registro de batalla alterna entre el registro y el panel de mando.
- Cambiar orientación y Orientar cañón abren la brújula. El movimiento del tanque permite elegir la orientación final del cañón antes de confirmar, también en modo Rápida.
- Al abandonar un vehículo, elige la orientación y, si quieres avanzar o atacar como Soldado ese mismo turno, selecciona el destino antes de confirmar.
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
- `src/match-presets.ts`: ritmos de partida y despliegue de Escaramuza.
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
- `src/scenarios.ts`: definiciones de Academia y evaluación de objetivos.
- `src/ai-strategy.ts` y `src/ai-worker.ts`: estrategias con presupuesto y cancelación.
- `src/match-storage.ts`: preferencias, autoguardado y progreso local.
- `src/achievements.ts`: catálogo, condiciones deterministas y persistencia versionada de logros.
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
