# Atlas de Asedio

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
pnpm test:ui
```

`pnpm test` valida geometría y reglas del motor. `pnpm test:ui` usa Edge o Chrome instalado para comprobar Canvas, flujo de acción, teclado y layout móvil. Puede indicarse otro navegador con `PLAYWRIGHT_BROWSER_PATH`.

## Controles

- Ratón o táctil: seleccionar unidad, elegir marcador y confirmar orden.
- Arrastrar: desplazar cámara.
- Rueda o pinza: zoom.
- `W A S D`: navegar por el tablero.
- `Enter`: seleccionar casilla enfocada.
- `Esc`: cancelar orden o selección.

## Estructura

- `src/engine.ts`: reglas puras, turnos, combate y finales.
- `src/hex.ts`: coordenadas axiales y conversión a Canvas.
- `src/renderer.ts`: tablero, glifos, capas y animaciones.
- `src/audio.ts`: paisajes sonoros sintetizados con Web Audio.
- `src/main.ts`: interacción, accesibilidad y flujo de interfaz.
- `tests/engine.test.ts`: pruebas de reglas y casos límite.

No usa recursos gráficos o sonoros externos. Logotipo, fichas, efectos y audio se generan localmente.
