# Auditoría de arquitectura y jugabilidad — 2026

## Diagnóstico

El proyecto ya cubre el núcleo que normalmente se propondría para una segunda versión: motor determinista, IA por niveles en `Worker`, Academia, editor de escenarios, replay validado, autoguardado, PWA, teclado hexagonal y pruebas de accesibilidad. La evolución no debe duplicar esas funciones ni introducir un framework o un backend sin una necesidad demostrada.

La prioridad pasa a ser **reducir la carga táctica sin quitar profundidad** y continuar extrayendo responsabilidades de `engine.ts`, `main.ts` y `renderer.ts` mediante cambios pequeños.

## Referentes aplicables

- [Hexagonal Chess](https://www.hexagonalchess.com/) confirma la escala del problema: el tablero de Gliński también tiene 91 casillas y las piezas centrales pueden tener muchas más jugadas legales que en el ajedrez ortogonal. La interfaz debe ayudar a leer opciones, no esconderlas.
- Las [reglas de Hexagonal Chess](https://hexagonalchess.com/rules) combinan análisis de tablero, variantes y finales reproducibles. Refuerzan la decisión de conservar un ruleset versionado y construir variantes sobre configuración.
- _Into the Breach_ basa su legibilidad en información determinista y ataques comunicados antes de resolverse. La lección útil aquí no es copiar sus turnos, sino ofrecer información táctica verificable y consecuencias claras.
- Las herramientas de análisis de ajedrez permiten recorrer posiciones y explicar alternativas. El replay actual ya ofrece la base para un futuro modo de análisis local, sin servidor.

## Cambios implementados en esta iteración

### 1. Identidad canónica de acciones

Se extrajo `actionKey` a `action-identity.ts`. Motor, IA y `MatchController` dependen ahora del mismo contrato y dejaron de comparar órdenes mediante la serialización incidental del objeto.

Principios aplicados:

- **SRP:** la identidad de una acción tiene un único dueño.
- **OCP:** una nueva variante de `GameAction` se incorpora en una unión exhaustiva central.
- **DIP:** el controlador depende de una operación de dominio (`sameAction`), no del formato JSON.

### 2. Servicio de análisis táctico

`tactical-analysis.ts` calcula amenazas inmediatas a partir de acciones legales y eventos ya resueltos por el motor. No replica reglas de piezas ni conoce Canvas, DOM o almacenamiento.

- Detecta destrucción, conversión y daño parcial a Fortaleza.
- Respeta apilamientos, intercepciones y protección antiaérea porque reutiliza el motor.
- No muta el estado.
- Memoiza por referencia de `GameState` para evitar recalcular durante hover o renderizados repetidos.

### 3. Capa opcional de amenazas

- Botón persistente junto a los controles del tablero.
- Marcado por color **y** trazo discontinuo con indicadores radiales.
- Contador accesible en el nombre del control.
- Anuncio de amenaza en la representación textual del tablero.
- Detalle del tipo de atacante en la ficha de una unidad amenazada.
- Preferencia desactivada por defecto para no saturar a jugadores expertos.

### 4. Corrección de accesibilidad

Se eliminó un carácter `}` que aparecía al final de las etiquetas de casillas vacías para lectores de pantalla y se añadió una regresión E2E específica.

## Próximos incrementos recomendados

### Prioridad alta

1. **Adoptar `MatchStore` como fuente única de UI.** `main.ts` aún duplica selección, acción pendiente, animación y estado de IA fuera del store. Migrar una variable por cambio, empezando por `selectedId` y `pendingAction`.
2. **Separar generación y resolución del motor.** Extraer primero `OccupancyIndex`, después resolución de combate y finalmente condiciones de final. Mantener la API pública actual durante la migración.
3. **Modo de análisis local.** Extender el replay con ramas temporales no guardadas, comparación de consecuencias y retorno al historial. No requiere base de datos.
4. **Objetivos de Academia de varios turnos.** Añadir `win-in`, `survive` y `protect-piece`, con validación determinista y pistas progresivas.

### Prioridad media

5. **Detalles de amenaza bajo demanda.** Al activar una casilla marcada, listar atacante, tipo de consecuencia y orden legal, sin revelar una supuesta intención de la IA.
6. **Despliegues rápidos equilibrados.** Reutilizar `MatchConfig` para partidas de 10–15 minutos y validarlas con simulaciones locales de IA.
7. **Análisis postpartida explicable.** Señalar cambios de material, oportunidades de ataque a Fortaleza y órdenes alternativas; evitar etiquetas opacas de “error” sin explicación.
8. **Reloj funcional.** El contrato ya contiene `clockSeconds`, pero falta un servicio de reloj inyectable, pausa segura durante diálogos y tests con tiempo simulado.

### Deuda técnica controlada

- Dividir `styles.css` por tokens, layout y componentes solo cuando exista un proceso de build que conserve el orden explícito.
- Extraer cámara y hit-testing de `BoardRenderer` antes de añadir nuevos efectos.
- Evitar nuevas reglas opcionales en `GameState`; deben pertenecer a `MatchConfig` o a una implementación de ruleset.

## Estrategia de pruebas

- Unitarias para identidad, análisis táctico, mutabilidad e interacciones con Escudo/Fortaleza.
- Prueba de humo para activación del control, estado visual y etiquetas accesibles.
- Axe en escritorio.
- Build, lint y formato como puertas obligatorias.
- Inspección visual acotada en 1440×900 y 390×844.
