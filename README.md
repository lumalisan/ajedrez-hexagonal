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

- **Partida libre:** local o contra IA en cuatro dificultades, con doctrinas Equilibrada, Agresiva, Guardiana y Emboscada.
- **Presets:** Escaramuza, Táctica, Asedio y configuración Personalizada. Ajustan despliegue, ritmo e integridad inicial sin alterar el movimiento ni el combate de las unidades.
- **Disposiciones iniciales:** en Nueva partida → Personalizada puedes elegir Frente clásico, Columnas de asedio, Frente blindado (5 soldados y 4 tanques) o Frente de infantería (7 soldados y 2 tanques). Las dos nuevas variantes tienen un lanzamisiles a la izquierda y un avión a la derecha de la Fortaleza, vistos desde cada bando, y conservan 18 piezas por jugador. Disponibles en partida local y contra la IA.
- Al elegir una disposición, la vista previa muestra el ejército de Cian con los símbolos del tablero, su composición y una breve descripción. Se actualiza también al cambiar la vida de la Fortaleza; Ámbar utiliza la formación reflejada.
- **Academia táctica:** fundamentos, misión guiada de varios turnos, retos estratégicos y un reto diario determinista que usan `classic-v2`.
- **Laboratorio:** editor JSON validado y catálogo local.
- Autoguardado después de cada orden, continuar, importar/exportar y visor de repetición.
- Capa opcional de amenazas inmediatas, con detalle accesible y preferencias persistentes.
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
- En móvil vertical, toca o desliza el tirador inferior para abrir las órdenes de la unidad seleccionada. Puedes contraer una orden pendiente para consultar el tablero y volver a abrirla sin perderla; en horizontal, las órdenes aparecen en un panel lateral.
- Arrastrar: desplazar cámara.
- Rueda o pinza: zoom.
- Flechas de deshacer y rehacer junto al zoom: retroceder o recuperar órdenes en partidas locales de dos jugadores. Puedes volver varios pasos atrás; una orden nueva sustituye la continuación deshecha. El reloj conserva el tiempo consumido.
- `Q W E` y `A S D`: las seis direcciones hexagonales.
- `7 8 9 4 2 6`: alternativa con teclado numérico.
- `Enter`: seleccionar casilla enfocada.
- `Esc`: cancelar orden o selección.
- `U`/`Mayús+U`: recorrer unidades propias.
- `H`, `L`, `C`: ayuda, registro y centrar tablero.

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
