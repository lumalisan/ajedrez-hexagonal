# Protocolo Hexagonal

Juego táctico 2D para dos jugadores en tablero hexagonal. Implementado con TypeScript nativo y Canvas 2D según `docs/especificacion_juego_hexagonal.md`.

## Ejecutar

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
pnpm test
pnpm test:coverage
pnpm test:ui
pnpm test:a11y
```

`pnpm test` valida geometría, reglas, configuración, invariantes y replay. La cobertura tiene umbrales específicos del dominio. Las pruebas de UI y Axe usan Edge o Chrome; puede indicarse otro navegador con `PLAYWRIGHT_BROWSER_PATH`.

## Modos y datos

- **Partida libre:** local o contra IA Recluta, Táctico y Comandante.
- **Academia táctica:** ocho escenarios reproducibles que usan `classic-v1`.
- **Laboratorio:** editor JSON validado y catálogo local.
- Autoguardado después de cada orden, continuar, importar/exportar y visor de repetición.
- PWA instalable con caché offline del shell.

Los guardados declaran versión y ruleset. Una repetición importada se reconstruye acción por acción y se rechaza si contiene una orden ilegal.

## Controles

- Ratón o táctil: seleccionar unidad, elegir marcador y confirmar orden.
- Arrastrar: desplazar cámara.
- Rueda o pinza: zoom.
- `Q W E` y `A S D`: las seis direcciones hexagonales.
- `7 8 9 4 2 6`: alternativa con teclado numérico.
- `Enter`: seleccionar casilla enfocada.
- `Esc`: cancelar orden o selección.
- `U`/`Mayús+U`: recorrer unidades propias.
- `H`, `L`, `C`: ayuda, registro y centrar tablero.

## Estructura

- `src/engine.ts`: reglas puras, turnos, combate y finales.
- `src/game-config.ts`: configuración validada y contrato `classic-v1`.
- `src/match-record.ts`: diario versionado, replay y estadísticas.
- `src/match-store.ts` y `src/match-controller.ts`: estado explícito de partida e interfaz.
- `src/scenarios.ts`: definiciones de Academia y evaluación de objetivos.
- `src/ai-strategy.ts` y `src/ai-worker.ts`: estrategias con presupuesto y cancelación.
- `src/match-storage.ts`: preferencias, autoguardado y progreso local.
- `src/hex.ts`: coordenadas axiales y conversión a Canvas.
- `src/renderer.ts`: tablero, glifos, capas y animaciones.
- `src/audio.ts`: paisajes sonoros sintetizados con Web Audio.
- `src/main.ts`: interacción, accesibilidad y flujo de interfaz.
- `tests/engine.test.ts`: pruebas de reglas y casos límite.

No usa recursos gráficos o sonoros externos. Logotipo, fichas, efectos y audio se generan localmente.
