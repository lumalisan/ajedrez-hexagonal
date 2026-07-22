# Especificación completa — Juego de estrategia por turnos en tablero hexagonal (Python + Pygame)

## Rol y forma de trabajo

Eres un programador y arquitecto de software experto en Python. Tu tarea es implementar, de principio a fin, un juego de estrategia por turnos para 2 jugadores sobre un tablero hexagonal, con mecánicas inspiradas en el ajedrez (captura ocupando la casilla rival) pero con piezas y reglas propias.

Este documento reúne **toda** la especificación del juego en un único lugar, ordenada de lo general a lo particular: el tablero, el sistema de coordenadas, las 8 piezas y sus reglas, las reglas de interacción entre ellas, y las condiciones de turno y victoria. **Léela completa antes de escribir código**: varias reglas conectan piezas distintas entre sí (por ejemplo, las reglas de apilamiento con el Dron, en la sección 5, afectan a seis de las ocho piezas), así que conviene tener el conjunto completo en mente antes de diseñar el modelo de datos.

La sección 9 recoge los puntos que el diseño original no llega a definir del todo. Donde corresponda, adopta una implementación flexible en lugar de fijar una única solución permanente, e indica explícitamente qué asunciones tomas y por qué.

---

## 1. Resumen general

- Juego de estrategia por turnos para **2 jugadores**.
- Se juega sobre un **tablero hexagonal** compuesto por **casillas hexagonales**.
- Cada jugador dispone de **8 tipos de pieza**: Soldado, Capturador, Tanque de Medio Alcance, Tanque de Largo Alcance, Tanque Rápido, Dron, Portamisiles Antiaéreo y Fortaleza. Cada una tiene su propio movimiento, ataque y reglas especiales.
- **Objetivo del juego:** destruir la Fortaleza del rival.
- Implementación en **Python**, usando **pygame** para el tablero, las piezas y la interacción del jugador.

---

## 2. El tablero

- **91 casillas** con forma de hexágono regular, todas del mismo tamaño: **60 px de ancho x 52 px de alto**.
- Las casillas se organizan en anillos concéntricos alrededor de una casilla central:

| Anillo | Nº de casillas |
|---|---|
| Centro | 1 |
| 1er anillo | 6 |
| 2º anillo | 12 |
| 3er anillo | 18 |
| 4º anillo | 24 |
| 5º anillo | 30 |
| **Total** | **91** |

- El resultado de esta disposición en anillos es un tablero con forma general de **hexágono grande**.

**Nota técnica recomendada:** el ancho de casilla (60px) es mayor que su alto (52px), y —como se explica en la sección 3— las direcciones N y S son vecinas directas (verticales), lo que corresponde a hexágonos con orientación *flat-top* (lado plano arriba y abajo). Para representar el tablero y calcular vecinos, distancias y trayectorias de forma robusta, se recomienda usar internamente un sistema de **coordenadas axiales o cúbicas para hexágonos**, convirtiendo a coordenadas de píxel solo en el momento de dibujar.

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

| Pieza | Movimiento | Ataque | Rasgo distintivo |
|---|---|---|---|
| Soldado | 1 casilla, solo en las 3 direcciones "delanteras" según su orientación | Ocupa la casilla enemiga, dentro de su rango de movimiento | Puede girar sin moverse; destino final de los 3 tanques al transformarse |
| Capturador | 1 casilla, en cualquiera de las 6 direcciones | No destruye: convierte en aliada una unidad enemiga adyacente, sin moverse | Captura sin desplazamiento |
| Tanque de Medio Alcance | 1 casilla, en cualquiera de las 6 direcciones (+ orientar cañón, combinable) | Dispara a distancia 2, en un arco de 3 direcciones según su cañón | Transformable en Soldado |
| Tanque de Largo Alcance | 1 casilla, en cualquiera de las 6 direcciones | Dispara a distancia exacta de 3, en cualquiera de las 6 direcciones | Transformable en Soldado |
| Tanque Rápido | Línea recta sin límite de casillas, en cualquiera de las 6 direcciones | Ocupa la casilla enemiga (pieza deslizante, como una torre de ajedrez) | Transformable en Soldado |
| Dron | Línea recta hasta 3 casillas, en cualquiera de las 6 direcciones | Ocupa la casilla enemiga | Vuela sobre otras unidades; puede compartir casilla con una unidad aliada |
| Portamisiles Antiaéreo | 1 casilla, en cualquiera de las 6 direcciones | No ataca directamente | Genera una "zona protegida" que bloquea Drones/disparos enemigos y destruye Drones enemigos que queden dentro |
| Fortaleza | No se mueve | No ataca ni se defiende | Objetivo del juego: debe ser destruida |

### Reglas generales (aplican a todas las piezas salvo que se indique lo contrario)

- **Captura por ocupación:** salvo que se indique lo contrario, una pieza ataca a una unidad enemiga desplazándose a la casilla que esta ocupa y pasando a ocupar dicha casilla (igual que una captura en ajedrez); la unidad enemiga queda destruida.
- **Apilamiento:** una casilla puede contener **como máximo 2 unidades a la vez**, y únicamente en la combinación "una unidad terrestre + un Dron". Nunca puede haber dos Drones en la misma casilla, ni dos unidades terrestres en la misma casilla. Esta posibilidad la genera el Dron al desplazarse (sección 4.6); sus efectos en el combate se detallan en la sección 5, y un matiz pendiente de confirmar se recoge en la sección 9.

### 4.1 Soldado

- **Movimiento:** se desplaza una casilla por turno. Tiene una orientación (una de las 6 direcciones) y solo puede moverse a las 3 casillas situadas "delante" de él según esa orientación. Por ejemplo, orientado hacia N, solo puede moverse a NO, N o NE.
- **Cambio de orientación al moverse:** al desplazarse, el Soldado queda orientado hacia la dirección en la que se movió. Por ejemplo, si se mueve a NE, en el turno siguiente estará orientado hacia NE, y por tanto solo podrá moverse a N, NE o SE.
- **Ataque:** ataca desplazándose a una casilla ocupada por una unidad enemiga (dentro de las 3 casillas a las que puede moverse según su orientación actual), ocupando dicha casilla.
- **Girar:** en su turno, puede girar (cambiar de orientación) sin desplazarse. Si lo hace, no puede desplazarse ni atacar ese mismo turno. Girar cuenta como la acción del turno (sección 6).

### 4.2 Capturador

- **Movimiento:** se desplaza una casilla por turno, a cualquiera de las 6 casillas de su alrededor (no está limitado por orientación).
- **Captura:** si al **empezar su turno** (antes de desplazarse) hay una unidad enemiga en alguna de las 6 casillas de su alrededor, puede capturarla y convertirla en unidad aliada. Ni el Capturador ni la unidad capturada se desplazan: ambas permanecen en su posición.
- No puede capturar una unidad enemiga que quede a su alrededor **como consecuencia** de haberse desplazado él ese mismo turno; la adyacencia debe existir ya al inicio del turno.
- **Protección mutua:** si una unidad está en contacto simultáneo con un Capturador aliado (a ella) y un Capturador enemigo, esa unidad queda protegida y no puede ser capturada.

### 4.3 Tanque de Medio Alcance

- **Movimiento:** se desplaza una casilla por turno, a cualquiera de las 6 casillas de su alrededor.
- **Cañón:** puede orientar su cañón hacia cualquiera de las 6 direcciones, de forma independiente a la dirección del movimiento. **Desplazarse y orientar el cañón sí pueden combinarse en el mismo turno.**
- **Disparo:** dispara a las 3 casillas situadas **a 2 casillas de distancia**, delante de su cañón. Por ejemplo, con el cañón orientado a N, dispara a las casillas que están a 2 de distancia en las direcciones NO, N y NE — **no** a las casillas NO, N o NE mismas (distancia 1).
- **Disparar es una acción exclusiva:** si dispara, no puede desplazarse ni reorientar el cañón ese mismo turno; y si ya se desplazó y/o reorientó el cañón, no puede disparar ese turno. En resumen: "moverse + orientar cañón" es una combinación válida; "disparar" siempre va solo.
- **Transformación en Soldado:** puede convertirse permanentemente en Soldado. Al transformarse, el jugador elige libremente su orientación inicial, y en ese mismo turno puede además moverse o atacar (ya como Soldado). Una vez transformado, no puede volver a convertirse en tanque.

### 4.4 Tanque de Largo Alcance

- **Movimiento:** se desplaza una casilla por turno, a cualquiera de las 6 casillas de su alrededor.
- **Disparo:** dispara, en cualquiera de las 6 direcciones, a la casilla situada **exactamente a 3 casillas de distancia** en línea recta (no a 1 ni a 2 casillas; solo a la tercera). A diferencia del Tanque de Medio Alcance, no tiene cañón orientable: puede elegir libremente cualquiera de las 6 direcciones cada vez que dispara.
- **Disparar o moverse, nunca ambos:** debe elegir entre disparar o desplazarse en su turno.
- **Transformación en Soldado:** misma regla que el Tanque de Medio Alcance (sección 4.3): transformación permanente, orientación inicial libre, y puede moverse o atacar en el mismo turno de la transformación.

### 4.5 Tanque Rápido

- **Movimiento:** se desplaza en línea recta, en cualquiera de las 6 direcciones, sin límite de casillas, siempre que todas las casillas del trayecto estén libres. En la práctica, esto lo convierte en una pieza deslizante al estilo de una torre de ajedrez: se detiene en la primera casilla ocupada que encuentre en su camino.
- **Ataque:** ataca desplazándose a una casilla ocupada por una unidad enemiga, siempre que el trayecto hasta ella esté libre de otras unidades, ocupando dicha casilla.
- **Transformación en Soldado:** misma regla que los demás tanques (sección 4.3): transformación permanente, orientación inicial libre, y puede moverse o atacar en el mismo turno de la transformación.

### 4.6 Dron

- **Movimiento:** se desplaza en línea recta, en cualquiera de las 6 direcciones, hasta un máximo de 3 casillas.
- **Vuelo:** puede sobrevolar (pasar por encima de) otras unidades, tanto aliadas como enemigas, **excepto otros Drones**: ningún Dron puede pasar por encima de otro Dron ni terminar su movimiento sobre él, sea aliado o enemigo.
- **Apilamiento:** puede terminar su movimiento en una casilla ya ocupada por otra unidad, siempre que no sea otro Dron. Si esa unidad es enemiga, esto es un ataque (ver punto siguiente). Si es aliada, el Dron pasa a compartir casilla con ella (ver "Apilamiento" en las reglas generales de la sección 4).
- **Ataque:** ataca desplazándose a una casilla ocupada por una unidad enemiga, ocupando dicha casilla (si esa unidad enemiga está sola; si está apilada con otro Dron enemigo, ver la tabla de la sección 5).
- **Interacción con el resto de unidades:** las demás unidades (no Dron) pueden desplazarse a través de / hacia una casilla ocupada por un Dron **aliado**, pero no pueden hacerlo con un Dron **enemigo** (salvo mediante las reglas de ataque específicas contra Drones enemigos indicadas en la sección 5).

### 4.7 Portamisiles Antiaéreo

- **Movimiento:** se desplaza una casilla por turno, a cualquiera de las 6 casillas de su alrededor.
- **Zona protegida:** la casilla que ocupa, junto con sus 6 casillas vecinas (7 casillas en total), forman su "zona protegida".
- **Restricciones que impone sobre las unidades enemigas:**
  - Ningún Dron enemigo puede desplazarse sobre una casilla de la zona protegida.
  - Ningún Tanque de Medio Alcance enemigo puede disparar sobre una casilla de la zona protegida.
  - Ningún Tanque de Largo Alcance enemigo puede disparar sobre una casilla de la zona protegida.
- **Destrucción automática de Drones:** si, al finalizar un desplazamiento del Portamisiles, queda un Dron enemigo dentro de su zona protegida, ese Dron es destruido inmediatamente (sin necesidad de una acción de ataque aparte).

### 4.8 Fortaleza

- No se mueve, no ataca y no se defiende activamente. **Es el objetivo del juego**: gana quien destruye la Fortaleza rival.
- El **Soldado** y el **Capturador** solo le infligen **la mitad del daño** necesario para destruirla, y **mueren inmediatamente después de atacarla** (es un ataque de sacrificio). Hacen falta **dos** ataques de Soldado y/o Capturador, en cualquier combinación, para destruirla.
- **Cualquier otra pieza** (Tanque de Medio Alcance, Tanque de Largo Alcance, Tanque Rápido, Dron, Portamisiles Antiaéreo) la destruye con un único ataque, y no muere al hacerlo.
- **Sugerencia de implementación:** puedes modelarla con 2 "puntos de vida": un ataque de Soldado/Capturador resta 1 (y esa unidad se autodestruye tras atacar); un ataque de cualquier otra pieza resta los 2 de golpe.

---

## 5. Ataques sobre casillas con un Dron apilado

Cuando una pieza ataca o intenta capturar una casilla que contiene **un Dron enemigo apilado con otra unidad enemiga**, el objetivo permitido depende del tipo de pieza atacante:

| Pieza atacante | Objetivo permitido en una casilla [Dron enemigo + otra unidad enemiga] |
|---|---|
| Soldado | Solo la otra unidad; no puede atacar al Dron. |
| Tanque Rápido | Solo la otra unidad; no puede atacar al Dron. |
| Capturador | Solo la otra unidad; no puede capturar al Dron. |
| Dron | Solo el Dron enemigo; no puede atacar a la otra unidad. |
| Tanque de Medio Alcance | Elige libremente a cuál de las dos atacar. |
| Tanque de Largo Alcance | Elige libremente a cuál de las dos atacar. |

- Si la casilla objetivo tiene **solo** un Dron enemigo (sin ninguna otra unidad apilada), el Soldado y el Tanque Rápido sí pueden atacarlo con normalidad, y el Capturador sí puede capturarlo con normalidad. Las restricciones de la tabla solo aplican cuando hay **dos** unidades enemigas apiladas en la misma casilla.
- El Portamisiles Antiaéreo y la Fortaleza no tienen mecánica de ataque activo, por lo que esta tabla no les afecta.

---

## 6. Acción obligatoria por turno

- En cada turno, el jugador debe realizar alguna acción; **no se puede pasar turno**.
- Un disparo dirigido a una casilla vacía **nunca** cuenta como la acción del turno (no puede usarse un disparo "al aire" para evitar moverse de forma encubierta).
- Sí cuentan como acción válida, aunque no haya desplazamiento: que el Soldado gire sin moverse, o que el Tanque de Medio Alcance reoriente su cañón sin moverse.

---

## 7. Condición de victoria

Gana la partida el jugador que consiga destruir la Fortaleza rival (ver sección 4.8 para el daño necesario según el tipo de pieza atacante).

---

## 8. Qué debe incluir la implementación

1. **Tablero:** las 91 casillas hexagonales de la sección 2, con su renderizado gráfico.
2. **Modelo de datos de las piezas:** las 8 piezas de la sección 4, incluyendo su orientación donde aplique (Soldado, cañón del Tanque de Medio Alcance) y su posible apilamiento con un Dron.
3. **Lógica de movimiento y ataque** de cada pieza, incluyendo las reglas de apilamiento (sección 5) y las restricciones del Portamisiles Antiaéreo (sección 4.7).
4. **Bucle de juego por turnos**, alternando entre los 2 jugadores y aplicando la acción obligatoria (sección 6).
5. **Detección de la condición de victoria** (sección 7) y fin de la partida.
6. **Interfaz gráfica** en pygame: mostrar tablero y piezas, seleccionar una pieza, visualizar sus movimientos/ataques legales, y ejecutar la acción elegida.

Organiza el código de forma modular (por ejemplo: tablero/coordenadas, piezas y sus reglas, lógica de turno y validación de acciones, renderizado), con nombres claros y comentarios donde la lógica no sea evidente — el conjunto de reglas es extenso y varias piezas comparten mecánicas parecidas con matices distintos.

---

## 9. Aspectos no definidos en el diseño original

Estos puntos no quedaron cerrados en la especificación original. Antes de implementarlos, indica qué asunción vas a tomar y por qué (o pregunta si es posible aclararlo):

1. **Configuración inicial:** no se especifica cuántas unidades de cada tipo tiene cada jugador al empezar, ni su disposición inicial en el tablero. Se recomienda modelarlo como una estructura de datos de configuración editable (por ejemplo, una lista de `{tipo_pieza, jugador, casilla, orientación_inicial}`) en lugar de dejarlo fijo en el código.
2. **Línea de visión en los disparos:** no se especifica si el disparo del Tanque de Medio Alcance o del Tanque de Largo Alcance queda bloqueado por unidades situadas en las casillas intermedias de la trayectoria. La única obstrucción de disparo mencionada explícitamente es la zona protegida del Portamisiles Antiaéreo (sección 4.7).
3. **Disparo del Portamisiles sobre un Dron que llega después:** la regla dice que un Dron enemigo dentro de la zona protegida se destruye "al finalizar el desplazamiento" del Portamisiles. No queda explícito qué ocurre si, en lugar de moverse el Portamisiles, es el Dron enemigo el que se desplaza hacia una zona protegida ya existente: ¿se destruye igualmente, o el efecto solo se comprueba cuando se mueve el propio Portamisiles?
4. **Apilamiento con Dron aliado:** se interpreta que un Dron puede terminar su movimiento sobre una casilla con una unidad terrestre aliada, quedando ambas apiladas en esa casilla (sección 4.6) — es la única situación del juego en la que dos unidades del mismo jugador comparten casilla. Conviene confirmar que esta lectura es correcta.
5. **Resultado de un ataque parcial sobre una casilla apilada:** cuando una pieza que ataca desplazándose (Soldado, Tanque Rápido, Dron) solo puede eliminar a una de las dos unidades de una casilla apilada (por ejemplo, un Soldado que solo puede eliminar a la unidad que no es Dron), no se especifica si el atacante se desplaza igualmente a esa casilla, quedando apilado con la unidad enemiga superviviente. Es la lectura más consistente con el resto de las reglas, pero conviene confirmarla explícitamente, ya que crea casillas con unidades de bandos distintos compartiendo espacio, con implicaciones para los turnos siguientes.

---

Antes de escribir el primer código, resume brevemente: (a) las asunciones que vas a tomar para cada punto de la sección 9, y (b) la estructura de módulos/archivos que vas a usar. Después, procede con la implementación.
