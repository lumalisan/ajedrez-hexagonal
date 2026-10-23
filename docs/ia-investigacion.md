# Investigación reproducible de la IA

El laboratorio separa trayectorias, profesor, codificación, entrenamiento y evaluación de juego.
Las herramientas de investigación **no publican pesos ni demuestran por sí solas una mejora de
fuerza**. El modelo distribuido sigue separado de los candidatos. Se entrena en CPU con Python
y NumPy; `AI_PYTHON` selecciona el intérprete. No se instalan dependencias automáticamente.

## Datos y familias

Inventaría únicamente archivos o carpetas indicados explícitamente:

```powershell
pnpm exec node scripts/ai/dataset-inventory.mjs --inputs .ai-lab --output .ai-lab/inventory.json
```

Para preparar una selección reproducible, usa manifiestos JSON con
`{ "inputs": [{ "path": "partidas.jsonl", "role": "development" }] }`. Sus rutas son relativas
al manifiesto; `familyId` permite declarar un linaje conocido. Se admiten datasets con diarios,
guardados locales y arenas. No se recorren `runtime`, dependencias, build ni enlaces simbólicos.

```powershell
pnpm exec node scripts/ai/dataset-inventory.mjs --manifest fuentes.json --reserved-manifest reservas.json --output .ai-lab/inventory-seleccion.json --extract .ai-lab/development-trajectories.jsonl
```

La extracción conserva trayectorias legales bajo el motor actual y descarta sus etiquetas
antiguas. Un evaluador antiguo puede aportar posiciones útiles para reanalizar. Las arenas,
fuentes reservadas y familias compartidas con ellas quedan excluidas por defecto; los hashes
obsoletos o desconocidos se señalan, sin atribuirles el profesor actual.

`gameId` identifica una trayectoria; `familyId` agrupa linaje o apertura completa registrada.
Cuando el linaje no consta, se declara desconocido. Copias, perspectivas opuestas y variantes
no cuentan como partidas independientes. Conserva la familia entre workers y entrena con
`--split-group-field familyId`. La partición estable por umbral de hash evita que una familia
cambie de entrenamiento a validación al ampliar la memoria.

El inventario útil del 23 de octubre de 2026 reúne 104 trayectorias, 102 familias y 15.803
posiciones únicas, con 44 desenlaces del tablero. Solo 102 posiciones tienen seis unidades o
menos, sin contar Fortalezas. Se separaron 59 trayectorias históricas de evaluación. Estas
cifras describen cobertura disponible, no una mejora del modelo.

## Generar trayectorias nuevas

```powershell
pnpm exec node scripts/ai/fresh-trajectories.mjs --role development --games 8 --max-plies 240 --budget-ms 500 --depth 5 --seed 231001 --directory .ai-lab/nuevas-dev
```

`development` juega solo con búsqueda clásica `pvs-threats` y heurísticas a distancia, con
personalidades `balanced`, `aggressive`, `guardian` y `ambush` por bando. Congela sus fuentes
en una carpeta propia, guarda diarios/reglas/familias y hace checkpoints cada cuatro plies.
`--resume` conserva partidas terminadas. Para partir de un profesor ya congelado, añade
`--reference-root ruta/al/runtime`; la ruta exacta de una campaña está en `progress.json.runtime`.
Las trayectorias nuevas necesitan reanálisis: no contienen etiquetas neuronales.

La confirmación usa otra carpeta y otra semilla:

```powershell
pnpm exec node scripts/ai/fresh-trajectories.mjs --role confirmation --games 100 --opening-plies 4 --seed 231002 --directory .ai-lab/confirmacion-nueva --exclude-manifest .ai-lab/inventory-seleccion.json
```

`confirmation` genera solo `openings.json`: prefijos de 4–12 acciones legales, sin ejecutar
modelos ni búsquedas. Sortea disposición 3/5 y HP 1/2/3 independientemente por familia; no crea
rotaciones para inflar observaciones. Registra distribución, elecciones y rechazos por exclusión,
duplicidad o final prematuro. No mezcles este libro con desarrollo ni lo uses para seleccionar
candidatos. Su rol no sustituye registrar previamente el protocolo.

## Campaña congelada

```powershell
pnpm exec node scripts/ai/campaign.mjs --input .ai-lab/development-trajectories.jsonl --directory .ai-lab/campana --workers 4 --positions 2048 --positions-per-game 24 --budget-ms 5000 --probe-budget-ms 1000 --depth 9 --minimum-depth 3 --max-runtime-minutes 120
```

Es un experimento largo. Copia fuentes, pesos iniciales y datos antes de trabajar; `runtime-*`
es inmutable y `node_modules` se comparte con versiones fijadas por el lockfile. Cada familia
pertenece a un worker. La mezcla conserva parejas de perspectivas, deduplica posiciones y
registra etiquetas contradictorias antes del split por familia.

La campaña continúa los pesos iniciales con varias tasas, objetivos y semillas, selecciona por
MSE de validación y comprueba los candidatos retenidos en el banco de desarrollo. Terminar con
`ready-for-independent-evaluation` solo significa que están preparados para esa evaluación.

Repite los parámetros y añade `--resume`; el límite temporal por invocación puede ampliarse.
Los hashes verifican snapshot, datos y etapas completas. Los procesos propios se detienen al
agotar el plazo; un entrenamiento interrumpido se repite. Un lock huérfano se recupera solo tras
comprobar que su PID ya no existe; un `.guard` huérfano requiere revisar su PID. `running` en
un JSON no prueba que el proceso siga activo.

`pnpm ai:research` mantiene el piloto acotado anterior: compara hashes del repositorio pero no
crea la copia aislada de `campaign.mjs`. `sweep.mjs` congela pesos/dataset para experimentos
manuales; en ambos casos revisa la procedencia antes de reanudar.

## Profesor y codificación

```powershell
pnpm ai:reanalyze --input .ai-lab/development-trajectories.jsonl --output .ai-lab/profesor.jsonl --positions 1000 --positions-per-game 8 --budget-ms 5000 --probe-budget-ms 1000 --depth 9 --minimum-depth 3 --seed 231003
```

El profesor reconstruye acciones con las reglas de cada partida y usa evaluación clásica,
`pvs-threats` y `ranged-v1`, sin corrección neuronal. Rechaza profundidad insuficiente y guarda
acción, profundidad efectiva y desacuerdo con el sondeo corto. La búsqueda actual no expone una
variante principal completa y declara su ausencia. Más tiempo no garantiza etiquetas correctas.
Solo los desenlaces reconstruidos por el motor aportan resultados; reloj, rendición e inconclusas
no reciben victorias ni tablas inventadas.

El reanálisis sustituye etiquetas originales; no concatena ambas versiones de una trayectoria
con identidades distintas. Dos perspectivas representan una posición. El objetivo residual
conserva la escala acotada `classic-residual-v1` y la antisimetría del evaluador.

`hex-sparse-v2` conserva los 5.183 índices V1 y añade **20 características**: regla de turnos de
orientación activada/desactivada y órdenes restantes de cada bando, con nueve casillas por
contador (0–7 y ≥8). No introduce reglas nuevas. El evaluador reconoce V1/5.183 y V2/5.203;
el valor predeterminado y los pesos distribuidos V1 siguen siendo compatibles.

Al continuar V1 con un dataset V2, el entrenador añade a cero las filas nuevas de la primera
capa y conserva inicialmente su salida; registra `zero-extended-v1-to-v2`. No admite truncar
V2 a V1. Recodificar entradas no repite búsquedas: conserva los hashes del **profesor original**
y registra por separado los del **nuevo codificador**. No atribuyas a V2 etiquetas calculadas
por otro profesor ni presupuestos que no se usaron.

## Entrenamiento y diagnóstico

```powershell
pnpm exec node scripts/ai/sweep.mjs --input .ai-lab/profesor.jsonl --directory .ai-lab/barrido --learning-rates 0.00005,0.0002 --losses mse,huber --seeds 3 --split-group-field familyId --max-runtime-minutes 60
pnpm ai:benchmark --model .ai-lab/candidate.bin --champion src/ai-models/hex-value.bin --output .ai-lab/benchmark.json --budget-ms 1500 --depth 5 --partition development
```

MSE sigue siendo la selección de época, aunque se optimice Huber. El umbral Huber y
`--sample-weighting teacher-stability` son hipótesis experimentales; la validación MSE permanece
sin ponderar. Estudia curvas con subconjuntos anidados mediante `--max-training-games`; la
partición y ambas perspectivas se conservan. Menor MSE no demuestra mejores decisiones.

El banco público tiene 19 casos y 16 familias. Separa `verified` (objetivos tácticos comprobables
por el motor) de `preferences` (preferencias estratégicas). Una amenaza no demuestra captura
forzada ni que las alternativas sean peores. Registra errores, legalidad, profundidad y coste
junto a los resultados; los casos públicos tampoco son una confirmación independiente.

```powershell
pnpm exec node scripts/ai/diagnose.mjs --case-id tank-create-firing-line --output .ai-lab/diagnosis.json --budget-ms 500 --teacher-budget-ms 3000 --top-k 28
```

El diagnóstico comprueba respuestas que evitan amenazas, coste de inferencia y retención por
el selector. Su sondeo top-K es estático, sin historial/killer/transposiciones de una búsqueda
real: no lo presentes como traza de poda ni contrafactual de fuerza.

## Libros y confirmación de juego

`reserved-openings.mjs` prepara `hex-arena-openings-v1` con una posición por familia histórica,
elegida por material/progreso, sin consultar candidatos. Su rol `reserved-development` permite
cribado, no confirmación nueva. El libro tardío del 23 de octubre solo tiene seis familias con
diez unidades, después de 100 plies. Los seis casos de `endgame-cases.mjs` son cuatro familias
públicas de regresión: su prueba exhaustiva certifica el horizonte declarado, no fuerza general.

```powershell
pnpm ai:arena --model .ai-lab/candidate.bin --reference-model .ai-lab/champion.bin --openings .ai-lab/confirmacion-nueva/openings.json --pairs 100 --budget-ms 1500 --depth 9 --max-plies 240 --seed 231004 --output .ai-lab/arena-confirmacion.json
pnpm ai:assess --input .ai-lab/arena-confirmacion.json --output .ai-lab/assessment.json --method betting --minimum-pairs 100
```

La arena reproduce prefijos y reglas, intercambia bandos y exige familias suficientes; no cicla
variantes para completar pares. Fija candidato, rival, libro, semillas, presupuesto, criterio de
parada y método estadístico **antes de observar resultados**. Contra Experto clásico omite
`--reference-model`. Un ensayo a 1.500 ms solo describe ese presupuesto; el nivel de producto,
con hasta 15.000 ms, requiere evaluación propia. Un guardarraíl corto a 15 segundos no hereda
significación de cien pares jugados a otra velocidad.

Cada par completo de bandos es una observación, procesada en el orden de aperturas fijado.
Una partida inconclusa aporta puntos posibles [0,1]; nunca una tabla o derrota adjudicada.
La puntuación de partidas terminadas es descriptiva y puede estar sesgada por la censura.
`assess` conserva esos límites y exige por defecto 100 pares y 80% de finalización.

`--method hoeffding` reparte el error `alpha/(n*(n+1))` entre revisiones. `--method betting` usa
una mezcla fija de apuestas no negativas y el umbral de Ville, repartiendo alfa entre mejora y
regresión. La base de los procesos de apuestas y sus hipótesis se describe en
[Waudby-Smith y Ramdas, _Estimating means of bounded random variables by betting_](https://doi.org/10.1093/jrsssb/qkad009).
La validez necesita las hipótesis del muestreo y del nulo condicional: un conjunto fijo de casos,
semillas distintas o una posición por familia no las demuestra. El libro nuevo declara sus
exclusiones y muestreo sin reemplazo; no afirma ser una muestra IID exacta.

Fija el método antes del torneo. Elegir entre candidatos, rivales o hipótesis después de mirar
los mismos resultados necesita control adicional del error o una confirmación nueva. Estos
informes no producen Elo absoluto ni autorizan publicación automática. Para publicar siguen
faltando regresiones, paridad Python/JS, Worker/navegador, build y disponibilidad offline.

## Estado y artefactos

Los datos, snapshots, pesos, paridad, logs, `progress.json` y resúmenes viven en `.ai-lab/`,
excluido de Git. No edites un runtime congelado para incorporar cambios: inicia otra campaña.
`complete` significa que terminaron etapas, no que el candidato sea mejor.

El piloto histórico `.ai-lab/research-20261023-pilot` aceptó 31 posiciones y reservó seis para
validación. MSE pasó de 0,003782 a 0,002849 con MSE y a 0,002479 con Huber. Los objetivos cabían
en un minibatch; las semillas no aportaron replicaciones independientes de fuerza. En la revisión
a 1.500 ms, ablación clásica, campeón y candidato cumplieron 13/14 criterios de desarrollo:
**no se observó una ventaja de decisiones del candidato**. Se verificaron paridad y Worker en
Edge, sin sustituir el modelo distribuido ni celebrar un torneo confirmatorio nuevo.

La campaña ampliada del 23 de octubre continúa como experimento en marcha. Sus datos finales,
barridos y confirmación de juego están pendientes; los libros preparados no son torneos jugados.
Consulta procesos, checkpoints y logs actuales para conocer la etapa real, sin deducir fuerza
de un estado de ejecución o una pérdida de entrenamiento.
