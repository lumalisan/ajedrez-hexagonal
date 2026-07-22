# Especificación completa — Juego de estrategia por turnos en tablero hexagonal (TypeScript + HTML5 Canvas)

## Rol y forma de trabajo

Tu tarea es diseñar e implementar un juego de estrategia por turnos para 2 jugadores sobre un tablero hexagonal, con mecánicas inspiradas en el ajedrez (captura ocupando la casilla rival) pero con piezas y reglas propias, utilizando TypeScript estructurado y modular con renderizado en un elemento HTML5 Canvas.

Este documento reúne **toda** la especificación del juego en un único lugar, ordenada de lo general a lo particular: el tablero, el sistema de coordenadas, las 8 piezas y sus reglas, las reglas de interacción entre ellas, y las condiciones de turno y victoria. Se debe tener en cuenta el conjunto completo de reglas para el diseño del modelo de datos, ya que varias mecánicas conectan piezas distintas entre sí (por ejemplo, las reglas de apilamiento con el Dron afectan a seis de las ocho piezas).

La sección 9 detalla las decisiones de diseño adoptadas para aquellos puntos que la idea original no definía por completo, permitiendo una base concreta para la codificación.

---

## 1. Resumen general

- Juego de estrategia por turnos para **2 jugadores**.
- Se juega sobre un **tablero hexagonal** compuesto por **casillas hexagonales**.
- Cada jugador dispone de **8 tipos de pieza**: Soldado, Capturador, Tanque de Medio Alcance, Tanque de Largo Alcance, Tanque Rápido, Dron, Portamisiles Antiaéreo y Fortaleza. Cada una tiene su propio movimiento, ataque y reglas especiales.
- **Objetivo del juego:** destruir la Fortaleza del rival.
- Implementación en **TypeScript (TS nativo)**, utilizando la **API de HTML5 Canvas** para renderizar el tablero, las piezas y gestionar la interacción del jugador a través de eventos de ratón/pantalla táctil.

---

## 2. El tablero

- **91 casillas** con forma de hexágono regular, todas del mismo tamaño: **60 px de ancho x 52 px de alto**.
- Las casillas se organizan en anillos concéntricos alrededor de una casilla central:

| Anillo     | Nº de casillas |
| ---------- | -------------- |
| Centro     | 1              |
| 1er anillo | 6              |
| 2º anillo  | 12             |
| 3er anillo | 18             |
| 4º anillo  | 24             |
| 5º anillo  | 30             |
| **Total**  | **91**         |

- El resultado de esta disposición en anillos es un tablero con forma general de **hexágono grande**.

**Nota técnica de diseño:** el ancho de casilla (60px) es mayor que su alto (52px), y —como se explica en la sección 3— las direcciones N y S son vecinas directas (verticales), lo que corresponde a hexágonos con orientación _flat-top_ (lado plano arriba y abajo). Para representar el tablero y calcular vecinos, distancias y trayectorias de forma limpia, se debe utilizar internamente un sistema de **coordenadas axiales o cúbicas para hexágonos**, convirtiendo a coordenadas de píxeles bidimensionales (X, Y) únicamente en el momento de dibujar en el Canvas.

---

## 3. Sistema de coordenadas y nomenclatura direccional

Para describir posiciones y movimientos, el juego usa una nomenclatura basada en puntos cardinales.

Para cualquier casilla **X** que no esté en el borde del tablero (es decir, que tenga sus 6 vecinos completos), sus vecinas se nombran así, en sentido horario empezando por arriba:

**N (norte) → NE (noreste) → SE (sureste) → S (sur) → SO (suroeste) → NO (noroeste) → (vuelta a N)**

La misma nomenclatura se usa para indicar **direcciones de desplazamiento en línea recta**. Por ejemplo, "desplazarse 3 casillas en dirección SE" significa recorrer 3 casillas consecutivas en línea recta hacia el SE: la casilla SE, y las dos siguientes en esa misma línea (a veces referidas como SE2 y SE3).

Esta nomenclatura es descriptiva, pensada para poder explicar con claridad las reglas de cada pieza. La implementación interna del tablero puede (y probablemente debería, ver nota técnica de la sección 2) usar un sistema de coordenadas distinto, siempre que resuelva correctamente, para cualquier casilla: sus 6 vecinos directos, las casillas en línea recta en cada una de las 6 direcciones, y la distancia entre dos casillas cualesquiera. Para evitar cualquier ambigüedad, en las reglas de cada pieza (sección 4) las distancias se describen en palabras ("a dos casillas de distancia", "a tres casillas de distancia") en lugar de usar abreviaturas numeradas.

---

## 4. Las piezas

Cada jugador cuenta con las 8 piezas siguientes.

### Vista rápida

| Pieza                   | Movimiento                                                                   | Ataque                                                                     | Rasgo distintivo                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Soldado                 | 1 casilla, solo en las 3 direcciones "delanteras" según su orientación       | Ocupa la casilla enemiga, dentro de su rango de movimiento                 | Puede girar sin moverse; destino final de los 3 tanques al transformarse                                      |
| Capturador              | 1 casilla, en cualquiera de las 6 direcciones                                | No destruye: convierte en aliada una unidad enemiga adyacente, sin moverse | Captura sin desplazamiento                                                                                    |
| Tanque de Medio Alcance | 1 casilla, en cualquiera de las 6 direcciones (+ orientar cañón, combinable) | Dispara a distancia 2, en un arco de 3 direcciones según su cañón          | Transformable en Soldado                                                                                      |
| Tanque de Largo Alcance | 1 casilla, en cualquiera de las 6 direcciones                                | Dispara a distancia exacta de 3, en cualquiera de las 6 direcciones        | Transformable en Soldado                                                                                      |
| Tanque Rápido           | Línea recta sin límite de casillas, en cualquiera de las 6 direcciones       | Ocupa la casilla enemiga (pieza deslizante)                                | Transformable en Soldado                                                                                      |
| Dron                    | Línea recta hasta 3 casillas, en cualquiera de las 6 direcciones             | Ocupa la casilla enemiga                                                   | Vuela sobre otras unidades; puede compartir casilla con una unidad aliada                                     |
| Portamisiles Antiaéreo  | 1 casilla, en cualquiera de las 6 direcciones                                | No ataca directamente                                                      | Genera una "zona protegida" que bloquea Drones/disparos enemigos y destruye Drones enemigos que queden dentro |
| Fortaleza               | No se mueve                                                                  | No ataca ni se defiende                                                    | Objetivo del juego: debe ser destruida                                                                        |

### Reglas generales (aplican a todas las piezas salvo que se indique lo contrario)

- **Captura por ocupación:** salvo que se indique lo contrario, una pieza ataca a una unidad enemiga desplazándose a la casilla que esta ocupa y pasando a ocupar dicha casilla; la unidad enemiga queda destruida.
- **Apilamiento:** una casilla puede contener **como máximo 2 unidades a la vez**, y únicamente en la combinación "una unidad terrestre + un Dron". Nunca puede haber dos Drones en la misma casilla, ni dos unidades terrestres en la misma casilla. Esta posibilidad la genera el Dron al desplazarse (sección 4.6); sus efectos en el combate se detallan en la sección 5.

### 4.1 Soldado

- **Movimiento:** se desplaza una casilla por turno. Tiene una orientación (una de las 6 direcciones) y solo puede moverse a las 3 casillas situadas "delante" de él según esa orientación. Por ejemplo, orientado hacia N, solo puede moverse a NO, N o NE.
- **Cambio de orientación al moverse:** al desplazarse, el Soldado adopta la orientación de la casilla a la que se movió. Si se desplaza en diagonal (por ejemplo, de N a NE o NO), es obligatorio actualizar su orientación hacia esa nueva dirección.
- **Ataque:** ataca desplazándose a una casilla ocupada por una unidad enemiga (dentro de las 3 casillas a las que puede moverse según su orientación actual), ocupando dicha casilla.
- **Girar:** en su turno, puede girar (cambiar de orientación) sin desplazarse. Si lo hace, no puede desplazarse ni atacar ese mismo turno. Girar cuenta como la acción del turno (sección 6).

### 4.2 Capturador

- **Movimiento:** se desplaza una casilla por turno, a cualquiera de las 6 casillas de su alrededor (no está limitado por orientación).
- **Captura:** si al **empezar su turno** (antes de desplazarse) hay una unidad enemiga en alguna de las 6 casillas de su alrededor, puede capturarla y convertirla automáticamente en unidad aliada. Ni el Capturador ni la unidad capturada se desplazan: ambas permanecen en su posición.
- No puede capturar una unidad enemiga que quede a su alrededor **como consecuencia** de haberse desplazado él ese mismo turno; la adyacencia debe existir ya al inicio del turno.
- **Protección mutua:** si una unidad está en contacto simultáneo con un Capturador aliado (a ella) y un Capturador enemigo, esa unidad queda protegida y no puede ser capturada.

### 4.3 Tanque de Medio Alcance

- **Movimiento:** se desplaza una casilla por turno, a cualquiera de las 6 casillas de su alrededor.
- **Cañón:** puede orientar su cañón hacia cualquiera de las 6 direcciones, de forma independiente a la dirección del movimiento. **Desplazarse y orientar el cañón sí pueden combinarse en el mismo turno.**
- **Disparo:** dispara a las 3 casillas situadas **a 2 casillas de distancia**, delante de su cañón. Por ejemplo, con el cañón orientado a N, dispara a las casillas que están a 2 de distancia en las direcciones NO, N y NE — **no** a las casillas NO, N o NE mismas (distancia 1).
- **Disparar es una acción exclusiva:** si dispara, no puede desplazarse ni reorientar el cañón ese mismo turno; y si ya se desplazó y/o reorientó el cañón, no puede disparar ese turno. En resumen: "moverse + orientar cañón" es una combinación válida; "disparar" siempre va solo.
- **Transformación en Soldado (Abandono del Tanque):** puede convertirse permanentemente en Soldado. Al transformarse, el jugador elige libremente su orientación inicial, y en ese mismo turno puede además moverse o atacar (ya como Soldado). Una vez transformado, el tanque original queda abandonado de forma irreversible y no se puede recuperar.

### 4.4 Tanque de Largo Alcance

- **Movimiento:** se desplaza una casilla por turno, a cualquiera de las 6 casillas de su alrededor.
- **Disparo:** dispara, en cualquiera de las 6 direcciones, a la casilla situada **exactamente a 3 casillas de distancia** en línea recta (no a 1 ni a 2 casillas; solo a la tercera). A diferencia del Tanque de Medio Alcance, no tiene cañón orientable: puede elegir libremente cualquiera de las 6 direcciones cada vez que dispara.
- **Disparar o moverse, nunca ambos:** debe elegir entre disparar o desplazarse en su turno.
- **Transformación en Soldado (Abandono del Tanque):** misma regla que el Tanque de Medio Alcance (sección 4.3): transformación permanente, orientación inicial libre, y puede moverse o atacar en el mismo turno de la transformación. No se puede recuperar el tanque.

### 4.5 Tanque Rápido

- **Movimiento:** se desplaza en línea recta, en cualquiera de las 6 direcciones, sin límite de casillas, siempre que todas las casillas del trayecto estén libres. Funciona como una pieza deslizante (similar a una torre de ajedrez): se detiene en la primera casilla ocupada que encuentre en su camino.
- **Ataque:** ataca desplazándose a una casilla ocupada por una unidad enemiga, siempre que el trayecto hasta ella esté libre de otras unidades, ocupando dicha casilla. No posee ataques o disparos a distancia.
- **Transformación en Soldado (Abandono del Tanque):** misma regla que los demás tanques (sección 4.3): transformación permanente, orientación inicial libre, y puede moverse o atacar en el mismo turno de la transformación. No se puede recuperar el tanque.

### 4.6 Dron

- **Movimiento:** se desplaza en línea recta, en cualquiera de las 6 direcciones, hasta un máximo de 3 casillas.
- **Vuelo:** puede sobrevolar (pasar por encima de) otras unidades, tanto aliadas como enemigas, **excepto otros Drones**: ningún Dron puede pasar por encima de otro Dron ni terminar su movimiento sobre él, sea aliado o enemigo.
- **Apilamiento:** puede terminar su movimiento en una casilla ya ocupada por otra unidad, siempre que no sea otro Dron. Si esa unidad es enemiga, esto constituye un ataque (ver sección 5). Si es aliada, el Dron pasa a compartir casilla con ella.
- **Ataque:** solo puede realizar su ataque en la casilla en la que finalice su desplazamiento, no a lo largo del recorrido. Ataca desplazándose a una casilla ocupada por una unidad enemiga, ocupando dicha casilla (si esa unidad enemiga está sola; si está apilada con otro Dron enemigo, ver la tabla de la sección 5).
- **Interacción con el resto de unidades:** las demás unidades terrestres pueden desplazarse por debajo de un Dron **aliado**, pero no pueden hacerlo por debajo de un Dron **enemigo** (el Dron enemigo bloquea el paso terrestre, salvo mediante las reglas de ataque específicas detalladas en la sección 5).

### 4.7 Portamisiles Antiaéreo

- **Movimiento:** se desplaza una casilla por turno, a cualquiera de las 6 casillas de su alrededor.
- **Zona protegida:** la casilla que ocupa, junto con sus 6 casillas vecinas (7 casillas en total), forman su "zona protegida", la cual queda blindada contra cualquier ataque o presencia por aire.
- **Restricciones que impone sobre las unidades enemigas:**
  - Ningún Dron enemigo puede desplazarse sobre una casilla de la zona protegida (en caso de intentar cruzarla o entrar en ella, es destruido de inmediato).
  - Ningún Tanque de Medio Alcance enemigo puede disparar sobre una casilla de la zona protegida.
  - Ningún Tanque de Largo Alcance enemigo puede disparar sobre una casilla de la zona protegida.
- **Destrucción automática de Drones:** si, al finalizar un desplazamiento del Portamisiles, queda un Dron enemigo dentro de su zona protegida, ese Dron es destruido inmediatamente (sin necesidad de una acción de ataque aparte).
- **Vulnerabilidades y limitaciones de ataque:** El Portamisiles Antiaéreo no puede realizar ataques activos sobre otro tipo de unidades. **Únicamente puede ser destruido por un Soldado o por un Tanque Rápido, o bien ser convertido por un Capturador**. Los tanques de Medio y Largo Alcance no pueden destruirlo bajo ninguna circunstancia (de ahí que una táctica útil sea abandonarlos para convertirlos en Soldados y poder atacarlo directamente).

### 4.8 Fortaleza

- No se mueve, no ataca y no se defiende activamente. **Es el objetivo del juego**: gana quien destruye la Fortaleza rival.
- El **Soldado** y el **Capturador** solo le infligen **la mitad del daño** necesario para destruirla, y **mueren inmediatamente después de atacarla** (es un ataque de sacrificio). Hacen falta **dos** ataques de Soldado y/o Capturador, en cualquier combinación, para destruirla.
- **Cualquier otra pieza** (Tanque de Medio Alcance, Tanque de Largo Alcance, Tanque Rápido, Dron, Portamisiles Antiaéreo) la destruye con un único ataque, y no muere al hacerlo.
- **Lógica de salud:** Se modela con 2 puntos de vida: un ataque de Soldado/Capturador resta 1 (y la unidad atacante se destruye tras resolver la acción); un ataque de cualquier otra pieza resta los 2 puntos directamente.

---

## 5. Ataques sobre casillas con un Dron apilado

Cuando una pieza ataca o intenta capturar una casilla que contiene **un Dron enemigo apilado con otra unidad enemiga**, el objetivo permitido depende del tipo de pieza atacante y se rige por las siguientes normas:

| Pieza atacante          | Objetivo permitido en una casilla [Dron enemigo + otra unidad enemiga] |
| ----------------------- | ---------------------------------------------------------------------- |
| Soldado                 | Solo la otra unidad; no puede atacar al Dron.                          |
| Tanque Rápido           | Solo la otra unidad; no puede atacar al Dron.                          |
| Capturador              | Solo la otra unidad; no puede capturar al Dron.                        |
| Dron                    | Solo el Dron enemigo; no puede atacar a la otra unidad.                |
| Tanque de Medio Alcance | Elige libremente a cuál de las dos atacar.                             |
| Tanque de Largo Alcance | Elige libremente a cuál de las dos atacar.                             |

### Reglas detalladas de resolución de combate en apilamientos:

1. **Ataques terrestres por ocupación (Soldado, Tanque Rápido):** Solo dañan a la unidad terrestre oculta bajo el Dron. Al resolver el ataque, el atacante se desplaza y ocupa físicamente la casilla, quedando situado **debajo** del Dron enemigo (quedando vulnerable a ser atacado por este Dron en el siguiente turno).
2. **Captura por tierra (Capturador):** Solo puede capturar a la unidad terrestre bajo el Dron. El Capturador permanece en su casilla de origen y la unidad capturada cambia de bando (se vuelve aliada), pero se mantiene en su posición física original bajo el Dron enemigo.
3. **Ataques de Dron contra Dron:** Si el ataque lo realiza un Dron aliado, este solo puede fijar como objetivo al Dron enemigo (no a la unidad terrestre inferior). Al destruirlo, el Dron atacante se posiciona en la casilla, quedando apilado sobre la unidad terrestre enemiga.
   - _Contraataque desde abajo:_ En el siguiente turno, si la unidad terrestre que quedó abajo es un Soldado, un Tanque Rápido o un Capturador, estos **sí pueden** atacar o capturar directamente al Dron enemigo situado sobre ellos. En cambio, los Tanques de Medio y Largo Alcance **no pueden** atacar a un Dron situado directamente sobre ellos.
4. **Disparos a distancia (Tanques de Medio y Largo Alcance):** Si tienen a tiro la casilla apilada, el jugador elige libremente a cuál de las dos unidades atacar (terrestre o Dron), eliminándola, pero en ningún caso puede dañar a ambas en el mismo turno.

---

## 6. Acción obligatoria por turno

- En cada turno, el jugador debe realizar alguna acción; **no se puede pasar turno**.
- Un disparo dirigido a una casilla vacía **nunca** cuenta como la acción del turno (no puede usarse un disparo "al aire" para evitar moverse de forma encubierta).
- Sí cuentan como acción válida, aunque no haya desplazamiento: que el Soldado gire sin moverse, o que el Tanque de Medio Alcance reoriente su cañón sin moverse.

---

## 7. Condición de victoria y resolución de empates

1. **Victoria por destrucción:** Gana la partida el jugador que consiga reducir a 0 los puntos de vida de la Fortaleza rival (sección 4.8).
2. **Declaración de tablas (Empate por bloqueo):** En situaciones de bloqueo táctico (cuando no se pueden realizar ataques legales, o cuando a ningún jugador le conviene variar su posición y se repite de manera cíclica la misma jugada en bucle), la partida finaliza de inmediato. El ganador se determina según las siguientes condiciones:
   - Si **ambas** Fortalezas se encuentran intactas (ambas con 2 HP), la partida se declara oficialmente en **tablas** (empate).
   - Si alguna de las Fortalezas fue dañada previamente (reduciendo su vida a 1 HP mediante el ataque de sacrificio de un Soldado o un Capturador), **ganará la partida el jugador que haya logrado infligir ese primer daño**.

---

## 8. Qué debe incluir la implementación en TypeScript

1. **Estructura del Proyecto:** Un entorno de ejecución en el navegador estructurado de forma modular (por ejemplo, dividiendo tipos de datos, coordenadas, tablero, motor de juego y renderizador en módulos TS independientes).
2. **Tablero:** Representación lógica y renderizado de las 91 casillas hexagonales de la sección 2 mediante la API Canvas 2D en base a coordenadas axiales.
3. **Modelo de datos de las piezas:** Definición estructurada de las 8 piezas de la sección 4, controlando su orientación (Soldado, cañón del Tanque de Medio Alcance), sus puntos de vida actuales, su estado de acción y su posible apilamiento en casillas.
4. **Lógica de movimiento y ataque:** Validación de reglas para cada pieza, incluyendo el tratamiento del apilamiento (sección 5) y las limitaciones espaciales impuestas por el Portamisiles Antiaéreo (sección 4.7).
5. **Bucle de juego por turnos:** Alternancia entre los 2 jugadores, aplicación del consumo de acciones por turno y verificación de la acción obligatoria (sección 6).
6. **Detección de victoria y empates:** Monitoreo del estado de las Fortalezas, registro cronológico del primer daño efectuado para resolver posibles bloqueos (sección 7) y finalización del flujo del juego.
7. **Interfaz gráfica basada en Web-Canvas:** Representación visual interactiva en la que el usuario pueda hacer clic en una casilla para seleccionarla, visualizar los movimientos y ataques legales mediante capas de color semitransparentes, e interactuar con botones HTML o controles integrados en el Canvas para realizar acciones complementarias (como girar, disparar o transformar unidades).

---

## 9. Aspectos resueltos del diseño original

Para asegurar una implementación coherente del software, se definen los siguientes criterios sobre los aspectos que carecían de especificación cerrada:

1. **Configuración inicial:** Se establece una disposición inicial de unidades simétrica para cada bando. Se modela a través de un arreglo de configuración editable en la inicialización del juego. El jugador 1 comienza en la zona superior del tablero, mientras que el jugador 2 inicia en la zona inferior.
2. **Línea de visión en los disparos:** Los disparos a distancia del Tanque de Medio Alcance y del Tanque de Largo Alcance no se ven bloqueados por unidades intermedias (ya sean aliadas o enemigas). Solo la zona protegida del Portamisiles Antiaéreo ejerce un bloqueo efectivo sobre estas trayectorias.
3. **Ingreso voluntario de un Dron en zona protegida:** Si un Dron se desplaza hacia una casilla que ya se encuentra bajo la influencia de la zona protegida de un Portamisiles Antiaéreo enemigo, dicho Dron es **destruido inmediatamente** al finalizar su movimiento.
4. **Apilamiento de unidades aliadas:** Un Dron puede terminar su movimiento de forma segura compartiendo casilla con una unidad terrestre de su mismo bando, permitiendo que ambas convivan en dicha casilla.
5. **Resultado de ataque parcial en casillas apiladas:** Si una unidad terrestre aliada ataca y destruye a la unidad terrestre enemiga de un apilamiento, pero las reglas de la sección 5 le impiden dañar al Dron enemigo que la acompaña, la unidad atacante avanza de todos modos y pasa a ocupar la casilla. Esto genera una casilla compartida de carácter mixto (un Dron de un jugador en el aire y una unidad terrestre del otro jugador en el suelo) con sus respectivas implicaciones para los turnos subsecuentes.
