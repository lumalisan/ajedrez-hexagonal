# Conservación del Embestidor y maniobra del Caza

## Problema reproducido

Se extrajeron ocho posiciones intermedias de las seis partidas aportadas por el jugador.
Las fixtures de `tests/fixtures/ai-strategic-positions.json` conservan piezas, contadores,
repeticiones y reglas de cada registro, sin nombres de participantes ni el texto del historial.
No se simplificó el tablero para sostener el diagnóstico.

El buscador podía preferir una captura con el Embestidor aunque lo perdiera inmediatamente.
Además de una diferencia material pequeña entre unidades, la elección de respaldo cuando
no terminaba ninguna iteración penalizaba transformaciones enemigas, pero omitía recapturas
normales y disparos. Eso afectaba a Experto y Neuronal. Las partidas también mostraban giros
del Caza y pérdidas de maniobra, aunque no todos los giros eran errores: algunas salidas en
línea recta estaban amenazadas y era necesario cambiar de rumbo.

## Cambios

- Los valores estratégicos de intercambio del Embestidor y del Caza pasan de 500 a 850 y
  de 460 a 700. Se comparten entre búsqueda clásica, transformaciones y amenazas a distancia.
  Neuronal conserva su suplemento de 160 para el Caza y su corrección residual aprendida.
  Son pesos de evaluación, no reglas, daño o puntuaciones de la interfaz.
- El respaldo calcula la mejor respuesta táctica inmediata mediante acciones del motor:
  capturas, conversiones, disparos y transformaciones. Considera cambios de material y munición;
  no convierte la captura de una unidad de alto valor en una prohibición absoluta.
- La movilidad del Caza comprueba todo el trayecto frente a intercepciones, corredores ocupados
  por otras aeronaves y las direcciones legales de un segundo vuelo sobre el tablero actual.
  Se valora el corredor que conserva su rumbo y se penalizan las salidas con poca continuidad.
  Esta aproximación no simula movimientos futuros del enemigo; la búsqueda sigue siendo necesaria.
- Las pruebas mantienen el sacrificio del Embestidor y el kamikaze del Caza cuando ganan,
  la simetría entre bandos, la inmutabilidad del estado y los giros necesarios para escapar.

No se han cambiado reglas, presupuestos de dificultad ni el binario neuronal distribuido.
Experto y Neuronal sí utilizan la evaluación y el respaldo corregidos.

## Comparación de decisiones

Se congelaron las fuentes anteriores y las del candidato en `.ai-lab/strategic-reference-v1`
y `.ai-lab/strategic-candidate-v1`. Las comparaciones mantienen el mismo binario neuronal,
las semillas de partida, las reglas y el presupuesto de tiempo; cambian las heurísticas del código.

En cuatro posiciones del Embestidor, para dos evaluadores (ocho decisiones) y 1.000 ms/
profundidad máxima 9, la referencia dejaba un Embestidor capturable en cinco decisiones;
la versión nueva no lo hace en ninguna. Se enumeran las respuestas legales del rival para
comprobar la exposición. Son posiciones de desarrollo usadas para preparar el cambio, no
una prueba independiente de fuerza general.

Una comparación adicional de 15.000 ms/profundidad máxima 9 reproduce el intercambio de
Embestidor por Dron en ambos evaluadores de la referencia, y lo evita en ambos evaluadores
del candidato. En la posición de escape del Caza, las dos versiones encuentran una salida
segura con ese tiempo; las pruebas nuevas cubren el presupuesto breve y los corredores.
Los archivos `strategy-before-v2.json`, `strategy-after-v2.json` y `strategy-*-15s.json` conservan
acciones y métricas de búsqueda en `.ai-lab/`.

El análisis adicional cuesta tiempo: en algunas posiciones se completa una profundidad menor
con los mismos milisegundos. El respaldo más seguro es especialmente relevante en esos casos.
No se presenta una mejora de decisiones concretas como una mejora garantizada de Elo.

## Partidas cortas entre versiones

Se añadieron `--reference-root` y hashes de fuentes a la arena para comparar buscadores distintos.
La herramienta rechaza referencias con otro motor, reglas clásicas, geometría o contratos de piezas.
Ambos bandos resuelven las órdenes con el mismo motor; la reanudación verifica también las fuentes.

Los cribados usan semilla 830308, dos pares con bandos intercambiados, disposiciones 3 y 5,
Fortaleza de 1 HP, cuatro órdenes de apertura, 250 ms/profundidad 5 y 120 órdenes adicionales.

| Comparación                                             | Victorias nuevas | Derrotas nuevas | Tablas | Inconclusas |
| ------------------------------------------------------- | ---------------: | --------------: | -----: | ----------: |
| Experto nuevo frente a Experto anterior                 |                2 |               0 |      0 |           2 |
| Neuronal nuevo frente a Neuronal anterior, mismos pesos |                0 |               0 |      0 |           4 |

Los informes están en `.ai-lab/strategic-v2-training/arena-expert.json` y `arena-neural.json`.
El lote es pequeño y el presupuesto reducido, con muchas iteraciones sin terminar la primera
profundidad. No equivale a una evaluación de Experto o Neuronal con 15 segundos por turno.
No hay evidencia suficiente para declarar superioridad general de Neuronal.

## Nuevo ensayo de aprendizaje

`ai:prepare-replays` vuelve a buscar posiciones de las seis partidas humanas y las 24 de
autojuego guardadas, sin reutilizar valoraciones de la evaluación antigua. Selecciona ocho
posiciones por partida, omitiendo el arranque común cuando hay suficientes órdenes.
El profesor usa evaluación clásica corregida, perfil `pvs-threats` y suplemento a distancia,
sin la corrección neuronal. Busca hasta profundidad 5 y 750 ms por posición.

Se obtuvieron 468 muestras (234 posiciones), de 30 partidas, con 246 resultados conocidos;
se descartaron seis posiciones porque no completaron una iteración. Las reglas se conservan
por muestra y partida; los desenlaces por reloj o rendición no se convierten en etiquetas del tablero.

El entrenamiento continúa el modelo distribuido con gradiente antisimétrico proyectado,
AdamW reiniciado, learning rate 0.0002, weight decay 0.001 y 40 épocas. La partición estable por
umbral de hash usa semilla 290319: 22 partidas/342 muestras de entrenamiento y 8 partidas/126
muestras de validación, sin vectores idénticos compartidos. La semilla de pesos es 20261020.

La MSE de validación pasa de 0.099347 a 0.094534 (4,84% menos), frente a 0.106546 sin corrección.
La mejor época es la 40. Es una señal de aprendizaje de esas etiquetas, no una estimación de Elo.

El candidato se enfrenta a los pesos anteriores con el mismo código corregido, semilla 830409
y el presupuesto corto anterior: **0 victorias, 1 derrota y 3 inconclusas**. No supera el cribado.
Se conserva en `.ai-lab/strategic-v2-training/candidate.bin` para análisis y no se instala.
No se inicia un torneo largo ni se deja activo un entrenamiento de varios días.

El ciclo admite `--replays` para conservar estos ejemplos junto a experiencias nuevas. Comprueba
la versión de evaluación y los hashes del profesor antes de incorporarlos. La siguiente evaluación
de fuerza debe usar partidas y aperturas reservadas y un presupuesto que complete iteraciones útiles.

## Comprobaciones finales

749 pruebas de Vitest y 15 pruebas del entrenador correctas; tipos, ESLint, Prettier y compilación
correctos. La comprobación offline verifica la precarga de los pesos, los recursos y los diálogos.
Los pesos distribuidos y el candidato se verifican en Edge a 1440×900 y 390×844: paridad de las
16 salidas y búsqueda legal en Worker. No se presentan estas comprobaciones como una medida de
fuerza. Las suites globales de UI y Axe no se ejecutaron para este cambio de lógica.
