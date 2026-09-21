# Protocolo Hexagonal

Juego táctico 2D para dos jugadores en tablero hexagonal. Implementado con TypeScript nativo y Canvas 2D según `docs/especificacion_juego_hexagonal.md`.

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
pnpm test
pnpm test:coverage
pnpm test:ui
pnpm test:a11y
```

`pnpm test:types` comprueba todos los archivos TypeScript del proyecto, incluidos el código, las pruebas y la configuración, sin generar archivos. También se ejecuta al hacer el build.

`pnpm test` valida geometría, reglas, configuración, invariantes y replay. La cobertura tiene umbrales específicos del dominio. Las pruebas de UI y Axe usan Edge o Chrome; puede indicarse otro navegador con `PLAYWRIGHT_BROWSER_PATH`.

## Modos y datos

- **Partida libre:** local o contra IA con un único selector de dificultad: Fácil, Media, Difícil y Experto. Los niveles superiores dedican más tiempo a anticipar respuestas; mantienen el mismo presupuesto de búsqueda en escritorio y móvil.
- **Presets:** Escaramuza, Táctica, Asedio y configuración Personalizada. Ajustan despliegue, ritmo e integridad inicial sin alterar el movimiento ni el combate de las unidades.
- **Disposiciones iniciales:** en Nueva partida → Personalizada puedes elegir Frente clásico, Columnas de asedio, Frente blindado (5 soldados y 4 tanques), Frente de infantería (7 soldados y 2 tanques) o Frente extendido (11 soldados y 2 tanques retrasados). Las cuatro primeras tienen 18 piezas por jugador; Frente extendido tiene 22. Las variantes blindada, de infantería y extendida tienen un lanzamisiles a la izquierda y un avión a la derecha de la Fortaleza, vistos desde cada bando. Disponibles en partida local y contra la IA.
- Al elegir una disposición, la vista previa muestra el ejército de Cian con los símbolos del tablero, su composición y una breve descripción. Se actualiza también al cambiar la vida de la Fortaleza; Ámbar utiliza la formación reflejada.
- **Academia táctica:** fundamentos, misión guiada de varios turnos, retos estratégicos y un reto diario determinista que usan `classic-v2`.
- Autoguardado después de cada orden y continuación desde el inicio. Ajustes ofrece directamente Exportar partida, Importar partida, Ver repetición e Historial de resultados.
- El visor de repetición permite recorrer la partida sin modificarla.
- PWA instalable con caché offline del shell.

Los guardados declaran versión y ruleset. Una repetición importada se reconstruye acción por acción y se rechaza si contiene una orden ilegal. El desenlace terminal también forma parte del registro: victoria por Fortaleza, tiempo o rendición, y tablas por bloqueo, repetición o falta de progreso sobreviven al autoguardado, la exportación y la reproducción.

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
- El panel de mando aparece al seleccionar una unidad, dentro del marco del tablero. En pantallas estrechas aparece debajo; puedes desplazarte por la página para consultar las órdenes. Cancelar deselecciona la unidad.
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
- `Esc`: cancelar orden o selección.
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
- `src/match-store.ts` y `src/match-controller.ts`: estado explícito de partida e interfaz.
- `src/scenarios.ts`: definiciones de Academia y evaluación de objetivos.
- `src/ai-strategy.ts` y `src/ai-worker.ts`: estrategias con presupuesto y cancelación.
- `src/match-storage.ts`: preferencias, autoguardado y progreso local.
- `src/hex.ts`: coordenadas axiales y conversión a Canvas.
- `src/renderer.ts`: tablero, glifos, capas y animaciones.
- `src/audio.ts`: paisajes sonoros sintetizados con Web Audio.
- `src/main.ts`: interacción, accesibilidad y flujo de interfaz.
- `tests/engine.test.ts`: pruebas de reglas y casos límite.

La auditoría técnica y el siguiente orden de evolución están en `docs/auditoria-mejoras-2026.md`.

No usa recursos gráficos o sonoros externos. Logotipo, fichas, efectos y audio se generan localmente.
