# Aprendizaje por autojuego

`pnpm ai:selfplay` ejecuta rondas de generación de partidas, entrenamiento y torneos.
Trabaja fuera de la interfaz, en CPU y sin servicio externo. Requiere Python con NumPy;
`AI_PYTHON` permite indicar el ejecutable. No instala dependencias automáticamente.

```powershell
# Si Python no está en PATH:
$env:AI_PYTHON = 'C:/ruta/a/python.exe'
pnpm ai:selfplay --rounds 3 --publish
# Tras detenerlo con Ctrl+C, repetir los parámetros y añadir --resume:
pnpm ai:selfplay --rounds 3 --publish --resume
```

Los datos, modelos e informes quedan en `.ai-lab/selfplay/`, excluido de Git. Usa otro
`--directory` para un experimento distinto. No pueden ejecutarse dos procesos en la misma
carpeta. `progress.json` identifica el campeón, las etapas terminadas y hashes de artefactos.
La reanudación exige parámetros y código idénticos; permite aumentar `--rounds`.
Tras un cierre forzado del sistema puede quedar `run.lock`: comprueba que su PID ya no existe
antes de eliminar únicamente ese archivo.

## Qué aprende

Cada ronda genera por defecto 24 partidas con aperturas y exploración aleatorias reproducibles,
disposiciones 3 y 5 y fortalezas de 1, 2 y 3 HP. Alterna autojuego, Experto clásico y un rival
histórico, cambiando el bando de la red. Desde la segunda ronda incluye el candidato anterior,
aunque no haya superado el filtro de promoción, para diversificar los rivales.

La búsqueda que dirige cada turno etiqueta las posiciones. Solo se aceptan valoraciones con
una iteración terminada. Se calcula el residuo respecto a la evaluación clásica y su suplemento
`ranged-v1`. En partidas terminadas, el resultado añade como máximo 500 puntos a ese residuo,
descontados por `0.98 ^ órdenes hasta el final`. Una decisión lejana al desenlace recibe menos
crédito o culpa que una próxima al final. La corrección total queda acotada a 2.000 puntos.
Se conservan ambas perspectivas; las inconclusas no reciben resultados inventados.

Las etiquetas llevan `labelVersion: bounded-outcome-v2`; el ciclo no mezcla etiquetas anteriores.
`scripts/ai/relabel-selfplay.mjs` permite recuperar las búsquedas y los resultados guardados sin
volver a jugar las partidas. Para residuos se utiliza `--teacher-weight 1`: el resultado ya se
incorpora antes de entrenar y no debe sumarse otra vez en unidades incompatibles.

El entrenamiento NumPy usa las últimas tres rondas, separa partidas completas entre
entrenamiento y validación, detiene el aprendizaje si deja de mejorar y exporta una red
residual antisimétrica con el perfil `pvs-threats`. Cada candidato continúa los pesos del campeón
con un optimizador AdamW nuevo, learning rate 0.0002 y weight decay 0.001. El gradiente optimiza
la misma salida `(red(perspectiva) - red(opuesta)) / 2` que usa el navegador; los minibatches
mantienen las dos perspectivas juntas. No hay red de política ni implementación de AlphaZero.
El ciclo usa una semilla de partición fija y un umbral de hash por partida: al ampliar la memoria,
una partida que entrenó pesos anteriores no puede pasar al conjunto de validación. Si el lote es
tan pequeño que no contiene ambas particiones, falla y solicita más partidas; no las reasigna.

Las partidas exportadas se pueden preparar junto a un dataset anterior de autojuego:

```powershell
pnpm ai:prepare-replays --records .ai-lab/mis-partidas/raw --selfplay .ai-lab/positions.jsonl --output .ai-lab/replays-actuales.jsonl --positions 8 --budget-ms 750 --depth 5
pnpm ai:selfplay --directory .ai-lab/ciclo-con-partidas --replays .ai-lab/replays-actuales.jsonl --rounds 3
```

La preparación valida todas las acciones, elimina reexportaciones duplicadas, preserva las reglas
de cada partida y recalcula las búsquedas y el baseline. Las conclusiones por tiempo o rendición
no se usan como victorias del tablero. El ciclo congela una copia del dataset aportado y comprueba
sus hashes de evaluación. La versión estratégica nueva exige `evaluationVersion: strategic-v2`;
las etiquetas anteriores no se mezclan automáticamente. Tras cambiar evaluación o buscador,
reconstruye las etiquetas con las búsquedas actuales antes de iniciar otro ciclo.

## Cuándo se acepta una versión

Antes de jugar, el entrenamiento debe mejorar un 1% la validación tanto frente a sus pesos iniciales
como frente a no aplicar corrección; una época óptima 0 se rechaza. Después se realiza un cribado
de cuatro partidas a 250 ms, fortalezas de 1 HP y 120 órdenes. Solo un balance positivo de victorias
frente a derrotas permite continuar; un cribado sin resultados no se considera aprobado.

El candidato que pasa esos filtros juega dos torneos independientes de los datos de entrenamiento, uno contra
el campeón congelado y otro contra Experto. Ambos usan la misma apertura dentro de cada par,
intercambian bandos y disponen de idénticos límites de búsqueda. Las semillas de generación
y torneo son diferentes. Los torneos no se incorporan al dataset de entrenamiento.

La promoción local requiere:

- Al menos 8 pares (16 partidas) por rival, con los dos bandos presentes en cada par.
- Al menos un 80% de partidas terminadas en ambos torneos.
- Un 60% de puntos contra el campeón y un 50% contra Experto, sobre **todas** las partidas.
  Victoria suma 1, tabla real 0,5 e inconclusa 0.

Es un filtro operativo conservador, no una prueba estadística de superioridad ni una estimación
de Elo. Jugar contra sí misma no garantiza mejorar; si no alcanza el filtro, se conserva el campeón.
Los informes registran modelos, resultados, profundidad efectiva y tiempos.
Un torneo termina anticipadamente si ya no puede alcanzar los filtros aunque gane todas las
partidas restantes. Si falla contra el campeón, se omite el torneo contra Experto.

Sin `--publish`, la promoción cambia exclusivamente el campeón del laboratorio. Con `--publish`,
solo se instala un campeón evaluado a 15.000 ms y profundidad máxima 9 y que pase la comprobación
de inferencia y Worker en Edge/Chrome. Se copian el binario y sus informes de entrenamiento y paridad
a `src/ai-models/`; los originales quedan respaldados en la carpeta del experimento. Se comprueba
que los archivos del juego no hayan cambiado antes de sustituirlos. Para que un despliegue existente
use el modelo nuevo hay que volver a compilar y distribuir el juego.

## Coste y recuperación

La generación permite hasta 1.500 ms por turno y profundidad 5. Los torneos permiten 15.000 ms
y profundidad 9. Con 240 órdenes por partida, los dos torneos de una ronda tienen un máximo
nominal conjunto de 32 horas de búsqueda, más generación y entrenamiento; pueden terminar antes.
Varias rondas pueden necesitar días. Un presupuesto pequeño puede no completar ninguna iteración
y dejar el dataset sin muestras: el entrenador falla y no promociona nada.

Se guardan etapas y lotes de dos partidas de generación. Un lote interrumpido se regenera;
el entrenamiento interrumpido se repite. Los torneos se reanudan desde checkpoints cada cuatro
órdenes, conservando partidas ya terminadas. Los hashes impiden reutilizar artefactos modificados.

Comprobación corta del circuito, **sin permitir promociones**:

```powershell
pnpm ai:selfplay --directory .ai-lab/selfplay-check --rounds 1 --games 6 --pairs 1 --play-budget-ms 1500 --play-depth 1 --budget-ms 100 --depth 1 --max-plies 2 --epochs 2 --seed 730291
```

Completar esta comprobación demuestra que el circuito funciona; no demuestra fuerza de juego.
Puede terminar en el filtro de validación y omitir los torneos, que es el comportamiento esperado
para un candidato que no aprende. El [diagnóstico del primer intento](ia-autojuego-diagnostico-2026-10-20.md)
conserva los motivos y las comparaciones de desarrollo.
