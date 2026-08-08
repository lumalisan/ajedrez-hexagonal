# Plan de mejoras de Protocolo Hexagonal

## Resumen ejecutivo

La siguiente evolución debería apoyarse en lo que el juego ya hace bien: un motor de reglas determinista y separado del renderizado, una presentación Canvas cuidada, controles táctiles y de teclado, accesibilidad básica, audio, multijugador local y una primera IA.

La recomendación principal es **no reescribir el proyecto ni introducir un framework de interfaz todavía**. Antes conviene dividir los tres archivos que concentran casi toda la complejidad (`main.ts`, `renderer.ts` y `engine.ts`), formalizar una configuración de partida y guardar las acciones de forma reproducible. Esa base permitirá añadir modos, dificultad de IA, guardado, repeticiones y escenarios sin duplicar reglas.

Respecto a los niveles: la versión actual ya funciona como una partida independiente, aunque no la llame así. Debería convertirse oficialmente en **Partida libre**, disponible desde el primer momento y sin progresión obligatoria. Los futuros niveles encajan mejor como **Desafíos tácticos** y, más adelante, como una campaña opcional.

Orden recomendado:

1. Proteger el comportamiento existente con pruebas y separar responsabilidades.
2. Mejorar el flujo de órdenes, el aprendizaje y la experiencia móvil.
3. Lanzar Partida libre 2.0 con configuración, guardado y varias dificultades.
4. Añadir desafíos/tutoriales usando el mismo motor configurable.
5. Valorar editor, juego en línea y variantes solo cuando la base anterior sea estable.

---

## 1. Punto de partida

### Fortalezas actuales

- El motor de `engine.ts` es puro: recibe un estado y una acción y devuelve el siguiente estado y sus eventos.
- Las reglas más delicadas ya están modeladas: apilamientos, Drones, protección antiaérea, transformación, sacrificio contra Fortaleza, bloqueo y triple repetición.
- `hex.ts` aísla correctamente la geometría axial del tablero.
- El estado y las acciones usan uniones discriminadas de TypeScript, lo que facilita validar todas las variantes.
- El renderizado Canvas ya contempla cámara, zoom, giro de perspectiva, animaciones, capas, marcadores y alto contraste.
- La interfaz incluye ratón, táctil, teclado, lector de pantalla, reducción de movimiento, opciones de audio y diseño responsive.
- Existen dos formas de jugar: dos personas en el mismo dispositivo y una persona contra la máquina.
- Hay 46 casos unitarios para motor e IA, además de una prueba de humo de interfaz en escritorio y móvil.

### Límites que frenarán nuevas funciones

| Área              | Situación actual                                                                                             | Consecuencia futura                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Orquestación      | `main.ts` supera las 1.300 líneas y mezcla estado, eventos, IA, persistencia, diálogos, HTML y accesibilidad | Cada modo nuevo obligará a tocar muchas zonas y aumentará el riesgo de regresión   |
| Reglas            | `engine.ts` supera las 1.000 líneas y reúne generación, resolución, finales, descripciones y registro        | Será difícil introducir variantes de tablero, objetivos o reglas sin condicionales |
| Renderizado       | `renderer.ts` supera las 1.200 líneas y contiene cámara, capas, glifos, animaciones y selección              | Los efectos y temas nuevos serán costosos de probar y mantener                     |
| Estilos           | Toda la interfaz vive en un único `styles.css` de más de 2.000 líneas                                        | Los cambios responsive y de componentes pueden interferir entre sí                 |
| Configuración     | El radio del tablero, el despliegue y la victoria clásica están fijados en módulos concretos                 | No hay una forma natural de describir desafíos o partidas personalizadas           |
| Partida           | Solo se persisten preferencias; el combate se pierde al recargar                                             | No se puede continuar, compartir ni reproducir una partida                         |
| IA                | Evalúa todas las acciones a un solo turno de profundidad en el hilo principal                                | Tiene poca profundidad táctica y puede bloquear la interfaz si crece la búsqueda   |
| UX de aprendizaje | La ayuda explica mucho de una vez, pero no guía al jugador dentro de una posición real                       | La carga inicial es alta para un juego con ocho piezas y reglas de capas           |
| Teclado           | El foco usa cuatro direcciones para una geometría de seis                                                    | La navegación no representa por completo el tablero hexagonal                      |

### Restricciones que conviene conservar

- El motor debe seguir siendo independiente del DOM, Canvas, audio y almacenamiento.
- Una misma acción debe producir siempre el mismo resultado.
- El juego clásico debe mantener sus reglas actuales salvo cambios de diseño deliberados y documentados.
- Ratón, táctil, teclado y lector de pantalla deben continuar siendo formas completas de interacción.
- La interfaz debe seguir funcionando sin backend para Partida libre local y contra la IA.

---

## 2. Visión de producto

Protocolo Hexagonal debería tener tres puertas de entrada independientes:

### Partida libre

La experiencia principal, sin niveles ni desbloqueos. El jugador elige rival y configuración y empieza inmediatamente.

- Dos personas en el mismo dispositivo.
- Contra la máquina.
- Más adelante, partida en línea.
- Configuración clásica por defecto y opciones avanzadas plegadas.

### Academia táctica

Contenido corto y dirigido que enseña o pone a prueba una mecánica concreta.

- Tutorial interactivo.
- Desafíos con posición inicial, objetivo y límite opcional.
- Puzles diarios o semanales cuando exista suficiente contenido.
- Progreso local no obligatorio y separado de Partida libre.

### Laboratorio

Espacio para experimentar cuando la arquitectura ya lo permita.

- Despliegues alternativos.
- Constructor de escenarios.
- Variantes de tablero o ejército.
- Importar y exportar posiciones.

La campaña narrativa, si se desea, debería construirse después sobre el sistema de escenarios de la Academia, no como un segundo motor.

---

## 3. Arquitectura objetivo

### 3.1 Principio de flujo único

Todas las formas de jugar deberían pasar por el mismo recorrido:

```text
Entrada del usuario/IA/red
        ↓
Intención de interfaz
        ↓
MatchController valida y emite una GameAction
        ↓
Motor puro aplica la acción
        ↓
Nuevo GameState + GameEvent[]
        ↓
Store notifica a vistas, Canvas, audio y persistencia
```

La IA, una repetición y un futuro rival remoto no deben tener caminos especiales dentro del motor; todos producen `GameAction`.

### 3.2 Estructura propuesta

No es necesario crear todos estos archivos a la vez. Es el destino al que llegar mediante extracciones pequeñas.

```text
src/
  app/
    bootstrap.ts
    match-controller.ts
    match-store.ts
    ui-state.ts

  domain/
    model/
      game-state.ts
      actions.ts
      events.ts
      pieces.ts
    rules/
      legal-actions.ts
      resolve-action.ts
      combat.ts
      anti-air.ts
      outcomes.ts
      repetition.ts
    board/
      hex.ts
      occupancy-index.ts
    notation/
      describe-action.ts

  game-definitions/
    types.ts
    classic.ts
    scenarios/

  ai/
    strategy.ts
    evaluator.ts
    one-ply.ts
    search.ts
    worker.ts

  rendering/
    board-renderer.ts
    camera.ts
    scene.ts
    layers/
    glyphs/
    animations/

  ui/
    input/
      pointer-controller.ts
      keyboard-controller.ts
    views/
      match-status.ts
      piece-card.ts
      action-panel.ts
      battle-log.ts
    dialogs/
    accessibility/

  infrastructure/
    preferences.ts
    match-storage.ts
    snapshot-migrations.ts
```

### 3.3 Configuración de partida

El primer contrato nuevo debería separar las reglas de una partida concreta:

```ts
interface MatchConfig {
  definitionId: string;
  rulesetId: 'classic-v1';
  participants: [Participant, Participant];
  board: BoardDefinition;
  setup: PieceSetup[];
  victory: VictoryDefinition;
  options: MatchOptions;
}
```

Esto permite que la partida clásica, un tutorial y un desafío usen exactamente el mismo motor con distinta configuración.

Decisiones recomendadas:

- Mantener `classic-v1` inmutable una vez que haya partidas guardadas.
- Representar el tablero con una lista o conjunto de hexágonos válidos, aunque el clásico siga generándose con radio 5.
- Mantener identificadores estables de piezas y definiciones.
- Validar cada configuración al crear la partida y fallar con mensajes claros en desarrollo.
- No añadir reglas opcionales directamente a `GameState`; deben venir de `MatchConfig` o del `Ruleset`.

### 3.4 Estado, historial y persistencia

El registro visible actual no es suficiente para reconstruir una partida. Se necesita un diario de acciones canónicas:

```ts
interface MatchRecord {
  version: 1;
  config: MatchConfig;
  initialState: GameState;
  actions: GameAction[];
  currentAction: number;
}
```

Con este contrato se obtienen varias funciones a la vez:

- Guardar y continuar.
- Repetir una partida paso a paso.
- Deshacer en modos donde esté permitido.
- Compartir una posición.
- Depurar errores reproduciendo la misma secuencia.
- Sincronizar una futura partida en línea mediante acciones, no mediante píxeles o eventos de interfaz.

El estado guardado debe llevar versión y migraciones. Nunca se debe asumir que un JSON antiguo coincide con los tipos TypeScript actuales.

### 3.5 Motor de reglas

La división del motor debe ser por responsabilidad, no necesariamente un archivo por pieza.

- `legal-actions`: calcula acciones sin modificar el estado.
- `resolve-action`: aplica únicamente una acción ya validada.
- `combat`: resuelve objetivos, apilamientos, sacrificios y destrucción.
- `anti-air`: calcula zonas y las intercepciones.
- `outcomes`: Fortaleza, bloqueo y repetición.
- `notation`: textos para interfaz y registro, fuera de las reglas.

Mejoras internas:

- Crear un índice de ocupación por hexágono una vez por estado o turno para evitar búsquedas repetidas sobre todas las piezas.
- Separar la identidad de una pieza de sus datos mutables.
- Añadir invariantes comprobables: una Fortaleza por jugador, máximo una capa aérea y una terrestre, todas las piezas dentro del tablero.
- Añadir una función pública `validateState` para pruebas, importación y guardados.
- Medir antes de optimizar; con 32 piezas el rendimiento actual no es un problema, pero el índice simplifica muchas reglas.

### 3.6 Controlador y estado de interfaz

`main.ts` debería convertirse gradualmente en un arranque pequeño. `MatchController` manejaría:

- Selección y cancelación.
- Acción pendiente y confirmación.
- Cambio de turno.
- Bloqueo de entrada durante animaciones.
- Solicitud y recepción de una acción de IA.
- Fin y reinicio de partida.

El estado de interfaz debe ser explícito y separado de `GameState`:

```ts
interface MatchUiState {
  selectedPieceId: string | null;
  pendingAction: GameAction | null;
  interactionMode: UiMode;
  focusedHex: Hex | null;
  hoveredHex: Hex | null;
  isAnimating: boolean;
  isOpponentThinking: boolean;
}
```

No hace falta incorporar Redux ni otra biblioteca. Un store pequeño con `getState`, `dispatch` y `subscribe` es suficiente.

### 3.7 Renderizado

El Canvas debería seguir siendo la tecnología principal del tablero. La separación propuesta es:

- Cámara y conversión cliente/mundo.
- Escena y orden de capas.
- Fondo y celdas.
- Zonas tácticas.
- Marcadores de acciones.
- Piezas y glifos.
- Animaciones y efectos.
- Foco, hover y última acción.

Los colores y tamaños deberían proceder de un tema compartido, no de dos listas independientes en CSS y TypeScript.

El hit-testing debe continuar basándose en coordenadas hexagonales, pero quedar fuera de la clase que dibuja. Así será posible probarlo sin Canvas.

### 3.8 IA

Definir primero una interfaz intercambiable:

```ts
interface AiStrategy {
  chooseAction(state: GameState, config: MatchConfig, budget: AiBudget): Promise<GameAction | null>;
}
```

Evolución sugerida:

- **Recluta:** evaluación de un turno con una pequeña variación entre jugadas razonables.
- **Táctico:** búsqueda de 2–3 plies con ordenación de movimientos.
- **Comandante:** profundización iterativa con presupuesto de tiempo y tabla de transposición.

La búsqueda debe ejecutarse en un Web Worker. La interfaz debe poder cancelarla al reiniciar, cerrar o cargar otra partida. Cada nivel necesita un presupuesto máximo en milisegundos, no una profundidad fija que pueda congelar dispositivos lentos.

### 3.9 CSS e interfaz HTML

- Separar tokens, layout, componentes, diálogos, accesibilidad y breakpoints.
- Mantener clases globales pequeñas y nombres orientados al componente.
- Centralizar espaciado, tipografía, colores, alturas táctiles y niveles de elevación.
- No migrar a React, Vue o similar solo para dividir archivos.
- Reevaluar un framework ligero únicamente si aparecen muchas pantallas con estado compartido fuera de la partida.

---

## 4. Mejoras de UX

### 4.1 Aprendizaje progresivo

La ayuda actual es útil como referencia, pero presenta muchas reglas simultáneamente. Añadir:

- Un tutorial interactivo de 5–7 minutos con una posición simplificada.
- Primera misión: seleccionar, preparar y confirmar.
- Misiones posteriores: orientación, disparos, apilamiento, zona AA, transformación y ataque a Fortaleza.
- Consejos contextuales que aparezcan solo la primera vez que una mecánica sea relevante.
- Una enciclopedia de piezas accesible desde la ficha seleccionada.
- Ejemplos animados o diagramas cortos para las reglas de apilamiento.

Los consejos deben poder desactivarse y reiniciarse desde Opciones.

### 4.2 Flujo de orden más claro

El flujo actual de preparar y confirmar protege contra errores, pero puede resultar lento cuando el jugador ya domina el juego.

- Añadir preferencia de confirmación: `siempre`, `solo ataques/acciones irreversibles` o `rápida`.
- Mantener confirmación obligatoria para abandonar un vehículo y proponer tablas.
- Mostrar en la tarjeta pendiente una consecuencia concreta: pieza capturada, daño a Fortaleza, sacrificio o intercepción.
- Conservar la distinción visual entre movimiento, captura, disparo, conversión e intercepción.
- Mostrar por qué una orden no es posible al inspeccionar una casilla bloqueada, sin llenar el tablero de mensajes.
- Añadir un botón visible de deshacer borrador cerca de la confirmación en móvil.

### 4.3 Lectura táctica del tablero

- Resaltar la última unidad movida y origen/destino hasta que empiece la siguiente orden.
- Añadir una capa opcional de amenazas sobre una unidad o Fortaleza seleccionada.
- Permitir fijar u ocultar zonas antiaéreas.
- Diferenciar alcance potencial de objetivos atacables.
- Añadir leyenda expandible en móvil en vez de ocultar conceptos.
- Mostrar claramente qué capa se está seleccionando en un apilamiento.
- Usar forma, icono y color a la vez; nunca depender solo del rosa, menta o lavanda.

La vista de amenazas debe ser una herramienta de consulta, no una predicción completa de la IA.

### 4.4 Móvil

El tablero y el panel funcionan en pantallas estrechas, pero el panel inferior puede obligar a alternar mucho entre tablero y controles.

- Convertir el panel de mando en una hoja inferior con tres alturas: contraída, ficha y orden completa.
- Mantener una barra de confirmación fija cuando haya una acción pendiente.
- Hacer visible la ficha resumida sin abandonar el tablero.
- Añadir un gesto o botón para encuadrar automáticamente la selección.
- Recordar zoom y cámara solo durante la partida actual.
- Probar 320, 390, 430 px y paisaje de baja altura en cada cambio de layout.

### 4.5 Teclado y accesibilidad

- Ofrecer seis direcciones reales mediante un mapa configurable, por ejemplo `Q/W/E` y `A/S/D`, además de una alternativa con teclado numérico.
- Mantener Enter/Espacio para activar y Esc para cancelar.
- Añadir atajos documentados para abrir ficha, registro, ayuda y centrar tablero.
- Anunciar origen, destino y consecuencia después de ejecutar una orden.
- Permitir recorrer las unidades propias sin navegar las 91 casillas.
- Probar la secuencia completa de una partida corta solo con teclado.
- Añadir comprobaciones automáticas con una herramienta como axe, además del tablero textual actual.
- Mantener y ampliar alto contraste y reducción de movimiento.

### 4.6 Multijugador local

- Añadir una pantalla breve de “Entrega el dispositivo” entre turnos, opcional, para ocultar la planificación anterior.
- Permitir nombres de jugadores y color/perspectiva inicial.
- Añadir reloj por jugador como opción, desactivado por defecto.
- Permitir deshacer la última acción solo si ambos jugadores lo aceptan o si la opción se activó al crear la partida.

### 4.7 Final de partida y análisis

- Resumen de capturas, daño a Fortaleza, transformaciones y duración.
- Navegación por el historial desde la posición inicial hasta el final.
- Botón “Analizar partida” separado de “Revancha”.
- Exportar un código o JSON de repetición.
- Desde el registro, centrar el tablero en la acción seleccionada.

---

## 5. Modos y funciones nuevas

### 5.1 Partida libre 2.0 — prioridad alta

Es el “modo sin niveles” recomendado y debe seguir disponible desde el inicio.

Flujo:

1. Elegir **Partida libre**.
2. Elegir rival: persona local o máquina.
3. Usar configuración clásica o desplegar opciones avanzadas.
4. Jugar sin requisitos de progreso.

Opciones avanzadas iniciales:

- Dificultad de IA.
- Perspectiva fija o giro por turnos.
- Confirmación de órdenes.
- Consejos contextuales.
- Reloj opcional.
- Pantalla de entrega en multijugador local.

Opciones posteriores, cuando `MatchConfig` esté consolidado:

- Despliegues alternativos equilibrados.
- Elección de bando.
- Semilla o código de posición.
- Tableros rápidos con menos unidades, si las pruebas de balance los validan.

### 5.2 Academia táctica — prioridad alta

Cada escenario debe definir:

- Posición inicial.
- Bando controlado.
- Objetivo.
- Condiciones de derrota opcionales.
- Límite de turnos opcional.
- Texto inicial, pistas y explicación final.

Primer conjunto sugerido:

1. Movimiento y orientación del Soldado.
2. Captura sin movimiento del Capturador.
3. Alcance y orientación del Tanque.
4. Distancia exacta del Lanzamisiles.
5. Vuelo y apilamientos del Dron.
6. Intercepción del Portamisiles.
7. Abandono de vehículo.
8. Asalto final a la Fortaleza.

Después pueden añadirse puzles de “gana en N turnos” sin tocar el motor clásico.

### 5.3 Guardar, continuar y repetir — prioridad alta

- Autoguardado local después de cada acción.
- Ranura de partida en curso por modo.
- Confirmación antes de sobrescribir.
- Repetición controlada por acciones.
- Importación con validación y mensaje de versión incompatible.
- Opción de deshacer limitada por las reglas de cada modo.

### 5.4 IA ampliada — prioridad media

- Tres dificultades comprensibles, no solo números.
- Indicador de pensamiento con cancelación.
- Variación controlada para evitar partidas idénticas en dificultad baja.
- Pruebas de posiciones tácticas, no únicamente “devuelve una acción legal”.
- Presupuesto de tiempo diferente para escritorio y móvil.

### 5.5 Personalización y escenarios — prioridad media

- Selector de despliegue predefinido.
- Editor de posición con validación.
- Exportar/importar escenario.
- Catálogo local de escenarios favoritos.
- Temas visuales que no cambien la legibilidad táctica.

El editor debe llegar después del formato versionado de configuración y guardado; hacerlo antes duplicaría validaciones.

### 5.6 Juego en línea — prioridad futura

No debería ser el siguiente gran desarrollo. Requiere:

- Identidad y salas.
- Servidor autoritativo que valide `GameAction`.
- Reconexión y recuperación desde historial.
- Control de versiones del ruleset.
- Relojes sincronizados.
- Gestión de abandono y tablas.
- Protección contra clientes manipulados.

El motor puro y el diario de acciones reducen mucho este coste, por eso son dependencias obligatorias.

### 5.7 Variantes experimentales — prioridad futura

Probar primero variantes que reutilicen las reglas:

- Despliegue aleatorio simétrico con semilla.
- Draft de unidades con presupuesto.
- Fortaleza en posiciones alternativas.
- Partida rápida.
- Objetivos de escenario diferentes a destruir la Fortaleza.

Terreno, niebla de guerra o nuevas piezas cambian profundamente el balance y la lectura visual. Deben tratarse como un ruleset nuevo, nunca como varios `if` dentro de `classic-v1`.

---

## 6. Roadmap por fases

Las fases expresan dependencias, no fechas. Cada una debe entregarse jugable y sin esperar a completar toda la arquitectura objetivo.

### Fase 0 — Red de seguridad

Objetivo: poder refactorizar sin alterar las reglas.

Entregables:

- Fixtures reutilizables de posiciones complejas.
- Pruebas de caracterización para generación y resolución de acciones.
- Pruebas de invariantes después de cada acción.
- Casos de partida completa y reproducción de una secuencia.
- Cobertura de teclado de seis direcciones diseñada, aunque se implemente en la fase 2.
- Comando de cobertura y umbral específico para el dominio.

Criterios de salida:

- Todas las reglas documentadas tienen al menos un caso positivo y uno negativo relevante.
- Una secuencia de acciones produce el mismo estado final al reproducirse.
- Build, lint, formato, unitarias y humo de UI pasan en CI.

### Fase 1 — Separación arquitectónica

Objetivo: reducir el coste de cada cambio sin reescribir el juego.

Entregables:

- `MatchController`, `MatchUiState` y store.
- Vistas HTML extraídas de `main.ts`.
- Preferencias y almacenamiento extraídos.
- Motor dividido por responsabilidades manteniendo la API pública.
- Renderizador dividido en cámara, capas y glifos.
- Tokens visuales compartidos y CSS segmentado.

Criterios de salida:

- `main.ts` se limita al arranque y conexión de módulos.
- Ningún módulo de dominio importa DOM, Canvas, audio o `localStorage`.
- La IA entra por la misma interfaz de acciones que una persona.
- No hay cambios de reglas ni de UX no planificados.

### Fase 2 — Partida libre 2.0 y UX esencial

Objetivo: mejorar la experiencia recurrente y hacer que la partida sobreviva a una recarga.

Entregables:

- Menú principal con Partida libre y Academia.
- Configuración de partida y `classic-v1`.
- Guardado automático y continuar partida.
- Preferencia de confirmación.
- Consecuencias de la orden más explícitas.
- Hoja inferior y confirmación fija en móvil.
- Navegación hexagonal completa por teclado.
- Pantalla de entrega opcional para dos personas.

Criterios de salida:

- Se puede iniciar una partida clásica con los mismos valores por defecto que ahora.
- Recargar recupera estado, turno, configuración e historial.
- Un guardado corrupto o incompatible no rompe el arranque.
- La partida puede completarse con ratón, táctil o teclado.

### Fase 3 — Academia e IA

Objetivo: reducir la barrera de entrada y aumentar la rejugabilidad en solitario.

Entregables:

- Formato `ScenarioDefinition`.
- Tutorial interactivo y ocho desafíos iniciales.
- Pistas y evaluación del objetivo.
- Tres estrategias/dificultades de IA.
- IA en Web Worker con cancelación y límite de tiempo.
- Pruebas tácticas por dificultad.

Criterios de salida:

- Los escenarios no duplican lógica de piezas.
- Todos pueden cargarse, reiniciarse y reproducirse.
- La IA nunca bloquea animaciones o entrada durante más de su presupuesto.
- El jugador puede ignorar Academia y entrar directamente en Partida libre.

### Fase 4 — Análisis y creación

Objetivo: convertir las partidas en contenido reutilizable.

Entregables:

- Visor de repetición.
- Estadísticas de partida.
- Importar/exportar posiciones.
- Editor de escenarios.
- Catálogo de despliegues.

Criterios de salida:

- Toda creación pasa por el mismo validador del dominio.
- Los formatos incluyen versión y ruleset.
- Una repetición importada no puede ejecutar acciones ilegales.

### Fase 5 — Conectividad y variantes

Objetivo: ampliar comunidad y contenido sin comprometer el clásico.

Entregables posibles:

- Salas privadas y reconexión.
- Partidas asíncronas.
- Puzle diario.
- Variantes con identificador de ruleset propio.
- PWA instalable y funcionamiento offline.

Esta fase necesita una decisión de producto y de infraestructura antes de empezar.

---

## 7. Backlog priorizado

| Prioridad | Iniciativa                               | Impacto                                     | Esfuerzo relativo | Dependencia                    |
| --------- | ---------------------------------------- | ------------------------------------------- | ----------------- | ------------------------------ |
| P0        | Pruebas de caracterización e invariantes | Reduce regresiones en todas las fases       | M                 | Ninguna                        |
| P0        | Extraer controlador y estado de UI       | Desbloquea modos y simplifica interacción   | M                 | Pruebas                        |
| P0        | `MatchConfig` y ruleset `classic-v1`     | Base de Partida libre y escenarios          | M                 | Pruebas                        |
| P0        | Diario de acciones y snapshot versionado | Guardado, replay, deshacer y red            | M                 | Configuración                  |
| P1        | Guardar/continuar automáticamente        | Evita pérdida de partidas                   | S–M               | Snapshot                       |
| P1        | Flujo de confirmación configurable       | Agiliza el juego experto                    | S                 | Controlador                    |
| P1        | Tutorial interactivo                     | Mejora la incorporación                     | M                 | Escenarios                     |
| P1        | Teclado de seis direcciones              | Completa accesibilidad y geometría          | S                 | Control de entrada             |
| P1        | Panel móvil como hoja inferior           | Reduce desplazamiento y pérdida de contexto | M                 | Vistas extraídas               |
| P1        | IA en Worker y dificultades              | Mejora solitario y rendimiento              | L                 | Interfaz de estrategia         |
| P2        | Visor de repeticiones                    | Análisis y contenido compartible            | M                 | Diario de acciones             |
| P2        | Pantalla de entrega y reloj local        | Mejora multijugador compartido              | S–M               | MatchConfig                    |
| P2        | Editor de escenarios                     | Multiplica contenido                        | L                 | Validador y formato            |
| P3        | Juego en línea                           | Amplía alcance del juego                    | XL                | Historial, versiones y backend |
| P3        | Nuevos rulesets                          | Rejugabilidad avanzada                      | L–XL              | Arquitectura y balance         |

---

## 8. Calidad y pruebas

### Motor

- Tests unitarios por regla.
- Tests de propiedades para geometría, simetría y conservación de invariantes.
- Tests de regresión con secuencias completas.
- Test de serialización y migración de snapshots.
- Test de equivalencia: aplicar acciones directamente o reproducir el diario produce el mismo estado.

### IA

- Siempre devuelve una acción legal o `null` si no existe.
- Nunca muta el estado de entrada.
- Encuentra victorias y defensas forzadas en posiciones de referencia.
- Respeta el presupuesto y responde a cancelación.
- Sus decisiones son reproducibles cuando se fija una semilla.

### Interfaz

- Flujo de seleccionar, preparar, cancelar y confirmar.
- Acciones con varias capas.
- Preferencias y recuperación de partida.
- Responsive en 320, 390, 430 y 1.440 px.
- Paisaje móvil de poca altura.
- Flujo completo solo con teclado.
- Pruebas automáticas de accesibilidad.
- Capturas visuales de los estados principales para detectar regresiones.

### Rendimiento

- Medir tiempo de cálculo de acciones legales.
- Medir frame de Canvas con todas las capas activas.
- Limitar el DPR y el trabajo animado como ya hace el renderizador.
- Ejecutar la IA fuera del hilo principal antes de aumentar profundidad.

---

## 9. Métricas de éxito

No es imprescindible instalar analítica remota. En desarrollo y pruebas de usabilidad se pueden medir:

- Tiempo hasta completar la primera orden legal.
- Porcentaje de jugadores que terminan el tutorial.
- Número de cancelaciones o acciones inválidas en la primera partida.
- Porcentaje de partidas continuadas después de recargar.
- Duración media y tasa de abandono por modo.
- Uso de ayuda contextual y enciclopedia.
- Tiempo de respuesta de IA por dificultad y dispositivo.
- Errores de reglas reproducibles mediante un diario de acciones.

Objetivos técnicos:

- El dominio no depende de infraestructura o interfaz.
- Añadir un escenario no exige cambiar el motor clásico.
- Añadir una estrategia de IA no exige cambiar la UI.
- Cualquier partida guardada declara su versión y ruleset.
- Las funciones esenciales se pueden completar con las tres entradas: puntero, táctil y teclado.

---

## 10. Riesgos y decisiones pendientes

### Riesgos

- **Refactor demasiado grande:** mitigarlo con extracciones pequeñas y API compatible.
- **Formatos guardados prematuros:** versionar desde el primer snapshot y validar al cargar.
- **Explosión de opciones:** mantener valores clásicos y ocultar configuración avanzada.
- **IA lenta en móvil:** usar Worker, presupuesto temporal y cancelación.
- **Escenarios que duplican reglas:** describir datos y objetivos, no programar excepciones por nivel.
- **Marcadores difíciles de distinguir:** combinar forma, icono, color y etiquetas accesibles.
- **Variantes que rompen balance:** separar rulesets y probarlos como productos distintos.

### Decisiones de producto antes de Fase 3

- Si Academia guardará estrellas, solo completado/no completado o ninguna puntuación.
- Qué significa cada dificultad de IA en comportamiento y tiempo.
- Si deshacer estará disponible contra IA, en local o en ambos.
- Si habrá reloj competitivo.
- Si los despliegues alternativos pretenden ser equilibrados o experimentales.

### Fuera de alcance inmediato

- Backend y cuentas.
- Matchmaking público.
- Campaña narrativa completa.
- Terreno, niebla de guerra y nuevas piezas.
- Migración a un framework de UI.

Estas ideas no se descartan; se aplazan hasta tener configuración, snapshots, escenarios y pruebas consolidados.

---

## 11. Primeras entregas recomendadas

Secuencia concreta de cambios para empezar sin una rama de refactor interminable:

1. **PR 1 — Caracterización:** fixtures, invariantes, replay de una secuencia y cobertura en CI.
2. **PR 2 — Estado de interfaz:** extraer `MatchUiState`, store y `MatchController` manteniendo la UI actual.
3. **PR 3 — Vistas e input:** separar tarjetas, diálogos, teclado y puntero de `main.ts`.
4. **PR 4 — Configuración clásica:** introducir `MatchConfig`, `BoardDefinition` y `classic-v1` sin cambiar el despliegue.
5. **PR 5 — Persistencia:** diario de acciones, snapshot V1, autoguardado y continuar.
6. **PR 6 — Partida libre 2.0:** nuevo menú, preferencias de partida y confirmación configurable.
7. **PR 7 — Academia mínima:** motor de escenarios más los dos primeros tutoriales.
8. **PR 8 — IA desacoplada:** interfaz de estrategia, Worker y primera selección de dificultad.

Después de estas entregas se debe revisar uso real y decidir entre ampliar Academia, construir repeticiones/editor o priorizar conectividad.

---

## Conclusión

La mejora con mayor retorno no es añadir muchas reglas nuevas, sino convertir la implementación actual en una plataforma para varios tipos de partida. El motor ya ofrece una base sólida; el siguiente paso es hacer explícitos la configuración, el controlador y el historial reproducible.

La propuesta de producto central es:

- **Partida libre siempre disponible, sin niveles.**
- **Academia y desafíos como contenido opcional.**
- **Campaña, editor y juego en línea construidos después sobre el mismo sistema de escenarios y acciones.**

Así el juego puede crecer sin perder la claridad táctica ni convertir cada nueva función en una excepción dentro del código actual.
