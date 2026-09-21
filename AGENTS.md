# Instrucciones del proyecto

Este archivo se aplica a todo el repositorio. Antes de editar, revisa `git status` y los archivos implicados; puede haber cambios del usuario o de otros agentes. Conserva el trabajo ajeno y no restaures funcionalidades que el usuario haya descartado.

## Producto y contexto

**Protocolo Hexagonal** es un juego táctico por turnos, en español, sobre un tablero de 91 hexágonos de radio 5. Los jugadores se identifican como Cian y Ámbar. Incluye partida local, rival de IA, Academia, Laboratorio de escenarios, historial y reproducción de partidas.

La aplicación es una SPA local con React, TypeScript estricto, Vite y PixiJS 8 (WebGL). React gestiona la interfaz; una sesión observable coordina el juego, y el motor de reglas permanece independiente del framework. Los controles comunes utilizan Tailwind CSS 4 y los selectores comparten React Select. No requiere un backend. Mantén esta arquitectura salvo que el trabajo solicitado justifique cambiarla.

- `README.md`: instalación, comandos, controles y reglas resumidas.
- `docs/especificacion_juego_hexagonal.md`: descripción de las reglas.
- `docs/auditoria-mejoras-2026.md` y `docs/plan-mejoras.md`: contexto y propuestas históricas; contrasta su vigencia con el código y las pruebas.
- Las instrucciones actuales del usuario prevalecen sobre propuestas antiguas. No implementes ideas pendientes de los documentos sin que formen parte del encargo.

## Gestor de paquetes

- Este proyecto utiliza **pnpm**. Usa la versión indicada en `packageManager` dentro de `package.json`.
- Instala dependencias con `pnpm install` y mantén actualizado `pnpm-lock.yaml` cuando cambien.
- Ejecuta scripts con `pnpm <script>` y herramientas locales con `pnpm exec <herramienta>`.
- Usa `pnpm add` y `pnpm remove` para gestionar dependencias.
- No uses npm, npx ni yarn para instalar dependencias o ejecutar comandos del proyecto; no generes `package-lock.json` ni `yarn.lock`.
- Los prefijos `npm:` de algunas dependencias son alias de paquetes compatibles con pnpm. Consérvalos.
- Para una instalación reproducible utiliza `pnpm install --frozen-lockfile`. Revisa `pnpm-workspace.yaml` antes de cambiar políticas de instalación o de ejecución de scripts de dependencias.
- No actualices dependencias como efecto secundario de una tarea de interfaz, reglas o documentación.

## Comandos habituales

- Desarrollo: `pnpm dev`.
- Tipos de todo el proyecto: `pnpm test:types`.
- Lint: `pnpm lint`.
- Pruebas: `pnpm test`.
- Compilación: `pnpm build` (incluye la comprobación de tipos).
- Formato: `pnpm exec prettier <archivos> --write`.
- Interfaz y accesibilidad: `pnpm test:ui` y `pnpm test:a11y`.
- Caché offline de producción: `pnpm test:offline` después de `pnpm build`.
- Cobertura: `pnpm test:coverage`.
- Vista previa del build: `pnpm preview`.

El hook `.husky/pre-commit` ejecuta `pnpm exec lint-staged`. La configuración vive en `lint-staged.config.mjs`: ejecuta ESLint y Prettier sobre archivos preparados para el commit y comprueba todo el proyecto con `pnpm test:types` cuando cambian archivos TypeScript, `package.json`, `tsconfig*.json` o la propia configuración. Conserva la función que devuelve el comando de tipos: evita que lint-staged añada nombres de archivos incompatibles con `tsc --project`.

## Mapa del código

| Área                    | Archivos principales                                                                                            | Responsabilidad                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Contratos y geometría   | `src/types.ts`, `src/hex.ts`                                                                                    | Uniones de piezas y acciones, coordenadas axiales y transformaciones.                         |
| Motor                   | `src/engine.ts`, `src/classic-rules.ts`, `src/action-identity.ts`                                               | Acciones legales, resolución, eventos, condiciones de final e identidad canónica de acciones. |
| Configuración           | `src/game-config.ts`, `src/setup.ts`, `src/match-presets.ts`                                                    | Ruleset, posiciones iniciales y presets.                                                      |
| Partidas                | `src/match-controller.ts`, `src/match-store.ts`, `src/match-clock.ts`                                           | Control de la partida, estado y reloj.                                                        |
| Sesión y suscripción    | `src/app/contracts.ts`, `src/app/game-session.ts`, `src/app/game-context.tsx`                                   | Snapshots y comandos de la sesión; coordinación de IA, persistencia y ciclo de vida.          |
| Persistencia y replay   | `src/match-record.ts`, `src/match-storage.ts`, `src/match-insights.ts`                                          | Registros versionados, almacenamiento local, historial y análisis.                            |
| IA y análisis táctico   | `src/ai.ts`, `src/ai-strategy.ts`, `src/ai-worker.ts`, `src/tactical-analysis.ts`, `src/action-consequences.ts` | Búsqueda, trabajo en Worker, amenazas y consecuencias.                                        |
| Interfaz React          | `src/main.tsx`, `src/app/app.tsx`, `src/app/panels.tsx`, `src/app/dialogs/`                                     | Entrada, pantallas, paneles, diálogos y flujo de interfaz.                                    |
| Controles compartidos   | `src/app/components/game-select.tsx`                                                                            | React Select sin estilos predeterminados, con utilidades de Tailwind y accesibilidad común.   |
| Tablero e interacción   | `src/app/board-canvas.tsx`, `src/renderer.ts`                                                                   | Ciclo de vida del Canvas, entrada de ratón, táctil y teclado, cámara y representación.        |
| Estilos y textos        | `src/styles.css`, `src/styles/tokens.css`, `src/styles/game.css`, `src/ui-copy.ts`                              | Capas de Tailwind, tokens visuales, CSS específico del juego y textos de interfaz.            |
| Representación y sonido | `src/renderer.ts`, `src/rendering/`, `src/audio.ts`                                                             | Escena PixiJS, cámara, glifos, animaciones y audio.                                           |
| Reglas y demostraciones | `src/rules-content.ts`, `src/rules-demo.ts`, `src/rules-sequences.ts`                                           | Texto de ayuda y secuencias animadas con acciones del motor.                                  |
| Academia y Laboratorio  | `src/scenarios.ts`, `src/scenario-catalog.ts`                                                                   | Lecciones, objetivos y validación de escenarios personalizados.                               |
| Recursos y PWA          | `public/`, `src/service-worker.js`, `vite.config.ts`                                                            | Recursos y plantilla del SW; Vite emite `sw.js` con precarga de todos los recursos del build. |
| Verificación            | `tests/`, `scripts/ui-smoke.mjs`, `scripts/a11y.mjs`                                                            | Pruebas unitarias, interacción de navegador y Axe.                                            |

## Reglas e invariantes que preservar

- El motor es la autoridad para determinar y resolver acciones. Reutiliza `getLegalActionsForPiece`, `applyAction` y la identidad canónica; evita duplicar reglas en la interfaz, la IA o las animaciones.
- Mantén las operaciones de dominio deterministas y libres de dependencias del DOM, Canvas o almacenamiento. No mutar el estado de entrada al resolver una acción.
- El ruleset actual es `classic-v2`. Cada impacto causa 1 punto de daño a la Fortaleza; Soldado, Capturador y Embestidor se sacrifican al atacarla. Consulta las constantes de `src/classic-rules.ts`.
- Una casilla admite como máximo una unidad terrestre y una aérea. Compartir coordenadas no fusiona las unidades: cada ataque afecta a un único objetivo.
- Respeta la protección y las intercepciones antiaéreas, el cambio de bando, las orientaciones y la transformación de vehículos en Soldado. Cualquier modificación de estas interacciones necesita pruebas de regresión.
- Las direcciones de `src/hex.ts` están en coordenadas del mundo; el punto de vista cian rota el tablero. Distingue dirección lógica y dirección visual al colocar piezas o animaciones.
- Preserva la compatibilidad de guardados y registros versionados. Un replay debe reconstruirse mediante acciones legales; los resultados terminales deben sobrevivir a guardar, importar y reproducir.
- Si añades estado a una pieza, revisa su tipo, validación, clonación, serialización, identidad de posición y reglas de transferencia. No añadas reglas de juego solo porque el renderer tenga un campo visual opcional.

## Interfaz y animaciones

- Los componentes React leen el snapshot de `GameSession` mediante `useGame` y ejecutan sus comandos. Evita mantener copias del estado de partida en componentes o añadir una suscripción manual junto al hook; el estado local se reserva para formularios y presentación.
- Usa JSX y eventos React para pantallas, paneles y diálogos; no reconstruyas la interfaz con `innerHTML` ni añadas listeners manuales a los controles que gestiona React. El renderer PixiJS mantiene su ciclo de animación fuera del estado de React.
- Tailwind CSS 4 se integra mediante `@tailwindcss/vite`. `src/styles.css` es la entrada de estilos y organiza las capas y el mapeo `@theme inline` de los tokens de `src/styles/tokens.css`. No actives Preflight como efecto secundario: la aplicación conserva su base visual existente.
- Utiliza Tailwind y los tokens compartidos para nuevos controles comunes. Mantén en `src/styles/game.css` el CSS específico del tablero, las animaciones y los estilos que requieran selectores propios; no es necesario convertir cada regla existente en utilidades.
- Reutiliza `GameSelect` para listas de opciones comunes. Mantén `unstyled` y `classNames`, etiquetas y mensajes en español, foco visible y listas cortas sin búsqueda ni borrado. Los menús de un diálogo deben montarse dentro de él; un portal a `body` quedaría fuera de su ámbito modal. Evita que las reglas globales de `input` alteren los campos internos de React Select.
- PixiJS usa objetos de escena persistentes y renderizado bajo demanda. Mantén los contratos visuales puros en `src/rendering/model.ts`, evita reconstruir la geometría estática por fotograma y libera los recursos GPU al desmontar.
- Los efectos que conecten Canvas, audio, teclado u otros recursos deben limpiar sus listeners, observadores y tareas al desmontarse. Las operaciones asíncronas de una sesión anterior no deben modificar una nueva partida ni reiniciar bucles después de `dispose`.
- Conserva el idioma español, la identidad cian/ámbar, los glifos distinguibles y la legibilidad de los indicadores. La información no debe depender únicamente del color.
- Mantén navegación por teclado, foco visible, etiquetas accesibles y representación textual del tablero. Comprueba escritorio y móvil al modificar layout o interacción.
- Respeta las preferencias de sonido, contraste y movimiento reducido. Detén bucles cuando su contenido esté oculto y libera observadores, temporizadores y listeners al desmontarlo.
- Las demostraciones de «Reglas» usan tablero plano, encuadre cercano, ritmo pausado y solo muestran las unidades implicadas. Conservan las posiciones entre pasos y ofrecen pausa, avance manual y reinicio.
- **Los estilos holográficos y su selector fueron descartados por el usuario. No reintroducirlos salvo nueva petición explícita.**
- Los recursos de `public/rules/` se utilizan en el manual; comprueba referencias y caché de la PWA si los cambias.

## Validación y entrega

- Tras cambios de código, ejecuta `pnpm test:types`, `pnpm lint` y las pruebas pertinentes. Para cerrar un cambio de lógica o configuración, valida también `pnpm test` y `pnpm build`.
- `tsconfig.json` incluye todos los archivos TypeScript y TSX del repositorio y excluye dependencias, build y cobertura. Evita silenciar errores con `any`, `@ts-ignore` o exclusiones nuevas en lugar de corregir el contrato.
- Los cambios visuales requieren inspección en navegador. Como referencia, utiliza 1440×900 y 390×844, además de `pnpm test:ui` y `pnpm test:a11y` cuando afecten a interacción o accesibilidad.
- Los scripts de navegador usan Playwright con Edge o Chrome instalado. Puedes indicar otro ejecutable con `PLAYWRIGHT_BROWSER_PATH`; UI usa el puerto 4174 y Axe el 4175.
- Las pruebas de lógica usan Vitest. Añade regresiones que comprueben comportamiento relevante; no dupliques la implementación en el test. Los umbrales de cobertura están en `vitest.config.ts`.
- Formato: Prettier, comillas simples, comas finales y ancho de 100 columnas. Mantén ESLint y los hooks activos.
- No versionar `node_modules/`, `dist/`, `coverage/`, logs ni capturas temporales de verificación.
- Revisa el diff final y comunica qué cambió, qué comprobaciones pasaron y cualquier fallo pendiente. No presentes un build correcto como prueba de que todas las pruebas de navegador pasaron.
- Cuando se solicite commit o push, usa commits semánticos (`fix:`, `feat:`, `chore:`, `docs:`, etc.), incluye solo los cambios correspondientes y verifica rama y remoto antes de subir. No uses force push ni alteres cambios ajenos.
