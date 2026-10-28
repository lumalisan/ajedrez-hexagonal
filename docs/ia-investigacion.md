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
pnpm ai:fresh --role confirmation --sampling iid --games 100 --opening-plies 4 --seed 231002 --directory .ai-lab/confirmacion-nueva --exclude-manifest .ai-lab/inventory-seleccion.json
```

`confirmation` genera solo `openings.json`: prefijos de 4–12 acciones legales, sin ejecutar
modelos ni búsquedas. Sortea disposición 3/5 y HP 1/2/3 independientemente por familia; no crea
rotaciones para inflar observaciones. Registra distribución, elecciones y rechazos por exclusión,
duplicidad o final prematuro. No mezcles este libro con desarrollo ni lo uses para seleccionar
candidatos. Su rol no sustituye registrar previamente el protocolo.

Para confirmación con hipótesis de sorteos independientes usa `--sampling iid`: conserva las
repeticiones naturales, asigna un `drawId` distinto a cada sorteo y solo rechaza prefijos
terminales o familias del manifiesto fijo. No incorpora familias recién sorteadas a las
exclusiones. El libro declara `samplingUnit: iid-draw` y su protocolo; la arena conserva su orden
y cada sorteo. El valor predeterminado `without-replacement` sigue seleccionando familias
distintas y no afirma satisfacer esas hipótesis estadísticas. Son flujos pseudoaleatorios
reproducibles, no una certificación de aleatoriedad física.

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

```powershell
pnpm ai:reencode --input .ai-lab/profesor.jsonl --output .ai-lab/profesor-v2.jsonl --report .ai-lab/recodificacion.json
```

La recodificación reproduce todos los diarios, exige parejas completas con etiquetas opuestas
y verifica que cada entrada V1 coincide con el estado reconstruido. Solo modifica entradas y
metadatos de codificación. Conserva los campos del profesor y rechaza sobrescribir salidas.

## Entrenamiento y diagnóstico

```powershell
pnpm ai:sweep --input .ai-lab/profesor.jsonl --directory .ai-lab/barrido --learning-rates '0.00005,0.0002' --losses 'mse,huber' --seeds 3 --split-group-field familyId --max-runtime-minutes 60
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

El ámbito `fullgame` identifica libros de aperturas de partida completa; también se admiten
`midgame`, `endgame` y `midgame/endgame`. Cada entrada conserva el estado inicial, su prefijo
legal y sus reglas al intercambiar bandos o reanudar. El ámbito describe la posición de partida;
el motor determina los desenlaces.

`reserved-openings.mjs` prepara `hex-arena-openings-v1` con una posición por familia histórica,
elegida por material/progreso, sin consultar candidatos. Su rol `reserved-development` permite
cribado, no confirmación nueva. El libro tardío del 23 de octubre solo tiene seis familias con
diez unidades, después de 100 plies. Los seis casos de `endgame-cases.mjs` son cuatro familias
públicas de regresión: su prueba exhaustiva certifica el horizonte declarado, no fuerza general.

```powershell
pnpm ai:arena --model .ai-lab/candidate.bin --reference-model .ai-lab/champion.bin --openings .ai-lab/confirmacion-nueva/openings.json --pairs 100 --budget-ms 1500 --depth 9 --max-plies 240 --seed 231004 --output .ai-lab/arena-confirmacion.json
pnpm ai:assess --input .ai-lab/arena-confirmacion.json --output .ai-lab/assessment.json --method betting --minimum-pairs 100
```

La arena reproduce prefijos y reglas e intercambia bandos. Los libros por familia exigen familias
suficientes; los libros IID exigen sorteos identificados suficientes y conservan repeticiones
naturales. No cicla variantes para completar pares. Fija candidato, rival, libro, semillas, presupuesto, criterio de
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
exclusiones y método. El modo predeterminado muestrea sin reemplazo; `--sampling iid` realiza
sorteos con reemplazo condicionados únicamente por exclusiones fijas y prefijos no terminales.

Fija el método antes del torneo. Elegir entre candidatos, rivales o hipótesis después de mirar
los mismos resultados invalida su uso como confirmación nueva. Si se prueban sucesivos
candidatos hasta encontrar uno ganador, hacen falta sorteos nuevos **y** control del error
acumulado entre intentos. `--trial k --alpha 0.05` asigna `0.05/(k*(k+1))` al intento `k`; la suma
de todas las asignaciones es 0,05. Cada índice debe ser único y quedar en un registro externo
fijado antes de ese intento. La herramienta no administra ese registro ni impide reutilizar índices.

```powershell
pnpm ai:assess --input .ai-lab/arena-confirmacion.json --output .ai-lab/assessment-global.json --method betting --fixed-horizon --minimum-pairs 100 --minimum-completion 0.95 --trial 1 --alpha 0.05
```

`--fixed-horizon` exige todos los pares previstos y usa el capital de apuestas al final,
en lugar de un máximo anterior. Este modo permite aplicar un filtro final más estricto cuando
el protocolo decide terminar todo el torneo. Sin la opción se conserva la prueba de Ville
para observación secuencial. No selecciones retrospectivamente el método favorable.

Estos informes no producen Elo absoluto ni autorizan publicación automática. Para publicar siguen
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

La campaña ampliada del 23 de octubre aceptó 1.668 posiciones (3.336 perspectivas) de 102
familias. Se entrenaron doce variantes V1 y doce V2 con la misma partición: 2.608 muestras de
entrenamiento y 728 de validación. La mejor V1 redujo MSE de 0,038512 a 0,033609; la mejor V2
obtuvo 0,033676. Los contadores nuevos no mejoraron esa métrica en este experimento.

El banco público completo a 1.500 ms detectó una regresión que el subconjunto de desarrollo
no mostraba: ambos candidatos cumplieron 12/13 objetivos tácticos comprobables frente a 13/13
del campeón. Fallaron la seguridad del Embestidor en `recorded-fast-expert-drone`. Por ello no
se sustituyó el modelo distribuido. Continúa el diagnóstico y la selección de desarrollo;
las cien aperturas IID nuevas no se usaron para elegir el sustituto.

Se compararon después cuatro coeficientes fijos de interpolación entre el campeón y los pesos
V1 nuevos (12,5%, 25%, 50% y 75% de pesos nuevos). El 25% conservó la respuesta al caso observado,
redujo MSE a 0,037020 (3,9% frente al campeón) y cumplió 13/13 objetivos tácticos y 19/19 criterios
públicos a 1.500 ms. El criterio adicional es una preferencia estratégica; no prueba superioridad
global. La paridad del candidato en Edge difiere como máximo en 4,55×10⁻¹³, con suma cero exacta
y decisión legal del Worker. Los dos tamaños de ventana usan el mismo ordenador.

El candidato quedó congelado con SHA-256
`ab610983e8993a5312f682e59234500fb9179cc710a86b40ad744f9b37d9b9d1`.
`confirmation-protocol-v1.json` fija cien sorteos IID, dos bandos por sorteo, 1.500 ms, profundidad
máxima 9 y tope de 600 plies jugados, repartidos entre cuatro procesos. La confirmación se
cerró por falta de evidencia suficiente: 37 partidas procesadas, 11 inconclusas. Aun terminando
las restantes, solo podrían obtenerse 189 resultados del motor, por debajo del mínimo fijado
de 190. Los diarios procesados se reconstruyeron legalmente; no se adjudicaron las truncadas.
El ensayo no demuestra mejora ni regresión y el candidato no se publicó. Su evaluación a 15 s
es un filtro separado. `confirmation-error-ledger.json` exige además el alfa 0,025 del primer
intento global y una evaluación final de todos los pares, sin cambiar el candidato ni los
parámetros del torneo ya fijado.

El filtro público a 15.000 ms y profundidad máxima 9 terminó sin cambios en las fuentes:
candidato y campeón cumplieron 13/13 objetivos tácticos y 17/19 criterios totales. Las ocho
partidas del libro construido, con ambos roles en cuatro familias, terminaron en tres órdenes
con el ganador esperado. Se verificaron sus diarios legales, estados finales y la primera
acción contra el conjunto de acciones ganadoras certificado. Son regresiones públicas,
no evidencia independiente de superioridad a 15 segundos.

Los informes locales son `campaign-1/progress.json`, `campaign-v2/progress.json`,
`v1-public-benchmark.json` y `v2-public-benchmark.json`, bajo `.ai-lab/autonomous-20261023/`.
El seguimiento de la confirmación está en `confirmation-iid-run-v1/progress.json`; el archivo
no demuestra por sí solo que los PIDs sigan vivos. Los resultados de cada worker se conservan
en su arena y se combinan en el orden de sorteos registrado.
`confirmation-iid-run-v1/rejection.json` registra el cierre por imposibilidad de cumplir el
filtro, y `legal-replay-audit.json` verifica las 37 partidas procesadas. Los cuatro workers
y su supervisor finalizaron. La siguiente hipótesis estudia un evaluador neuronal completo
y objetivos temporales con bootstrap para las trayectorias truncadas, manteniendo su desenlace
desconocido. Los candidatos nuevos necesitan otros sorteos y el siguiente índice de alfa.
Los libros preparados no son torneos jugados.
Consulta procesos, checkpoints y logs actuales para conocer la etapa real, sin deducir fuerza
de un estado de ejecución o una pérdida de entrenamiento.

## Evaluador directo y objetivos temporales experimentales

El contrato `direct-value-v1` permite que una red antisimétrica estime el valor completo de la
posición. Exige `includesRangedValue: true` y no admite escala residual. La búsqueda conserva
la selección táctica de acciones, pero omite el suplemento de valoración ranged ya incluido
en esa red. Los modelos residuales existentes mantienen su comportamiento. Los estados
terminales siguen usando el resultado establecido por el motor.

`direct-data.mjs` reproduce todas las acciones antes de generar etiquetas. Solo acepta entradas
declaradas `sourceRole: development`, conserva `familyId`, verifica hashes de entradas, modelo
y fuentes y no sobrescribe la salida. En modo `distill`, divide el valor completo del modelo
objetivo entre 10.000 y lo limita a [-1,1]. Es imitación del evaluador, no un profesor nuevo
ni evidencia independiente de fuerza.

```powershell
pnpm exec node scripts/ai/direct-data.mjs --input .ai-lab/trayectorias-desarrollo.jsonl --model src/ai-models/hex-value.bin --output .ai-lab/direct-distill.jsonl --mode distill
pnpm ai:train --input .ai-lab/direct-distill.jsonl --output .ai-lab/direct.bin --teacher-weight 1 --antisymmetric --split-group-field familyId --split-policy hash-threshold
```

El modo `td` calcula objetivos TD(λ) sobre la trayectoria legal desde la perspectiva fija del
bando 0; las muestras del otro bando reciben el negativo exacto. Para cada transición usa
`G[t] = gamma * ((1-lambda) * V[t+1] + lambda * G[t+1])`. La frontera terminal vale +1, -1 o 0
según el motor; una trayectoria truncada usa la última predicción congelada como bootstrap
y conserva `outcome: null`. `--td-weight` mezcla ese objetivo con la predicción estática.
El descuento introduce una preferencia de entrenamiento por resultados próximos: no añade
una regla de tablas ni convierte un ciclo observado en un resultado conocido.

```powershell
pnpm exec node scripts/ai/direct-data.mjs --input .ai-lab/trayectorias-desarrollo.jsonl --model .ai-lab/direct.bin --output .ai-lab/direct-td.jsonl --mode td --gamma 0.99 --lambda 0.95 --td-weight 0.75
pnpm ai:train --input .ai-lab/direct-td.jsonl --initialize-model .ai-lab/direct.bin --output .ai-lab/direct-td.bin --teacher-weight 1 --antisymmetric --split-group-field familyId --split-policy hash-threshold
```

Fija además el mismo `--split-seed` en todas las etapas para conservar la partición por familias.
El entrenador rechaza reutilizar pesos residuales como si fueran valores directos. La hipótesis
temporal procede del aprendizaje mediante predicciones sucesivas descrito por
[Sutton, _Learning to predict by the methods of temporal differences_](https://doi.org/10.1007/BF00115009).
Esto no garantiza convergencia ni superioridad de esta red no lineal: sigue siendo necesario
medir regresiones y fuerza en partidas nuevas con el control de error entre candidatos.

El experimento local `autonomous-20261025/direct-v1` preparó 9.572 posiciones de 120 partidas
y 118 familias (51 finales del motor y 69 trayectorias truncadas). Usa un runtime congelado.
Todavía no demuestra mejora ni sustituye los pesos distribuidos.

La destilación inicial pasó 13/13 casos tácticos y 19/19 criterios públicos a 1.500 ms. En cuatro
pares de desarrollo a 200 ms obtuvo una victoria, tres derrotas, tres tablas reales y una
partida truncada. Dos familias conservaban reglas históricas con tablas automáticas; no se
extrapolan sus resultados a la configuración actual. La variante temporal conservó la época
inicial: ninguna actualización mejoró su MSE de validación. Ninguna de las dos se publicó.

El diagnóstico posterior midió 108 estados jugados y 1.265 sucesores legales: RMSE de 1.803 y
1.753 puntos respectivamente frente al profesor estático congelado. En 111 de 834 cambios
de al menos 100 puntos, la red discrepó del signo del cambio del profesor. Esto no prueba
cuál acción era óptima; sí motiva ampliar la cobertura de transiciones antes de otra confirmación.

`--successors-per-position 4`, únicamente en modo `distill`, añade alternativas legales mediante
muestreo reproducible por tipos de acción. Cada rama conserva su familia y un prefijo completo
reproducible; no hereda el desenlace de la partida original. Se omiten ramas terminales y
trayectorias idénticas ya incluidas. Estas muestras aumentan cobertura, no familias independientes.

El conjunto ampliado contiene 33.103 posiciones (66.206 perspectivas), incluidas 26.472
alternativas legales. Una auditoría separada verificó todas las características, etiquetas,
familias y pares, reprodujo 19.121 acciones originales y resolvió cada rama desde su prefijo.
El entrenamiento conservó las mismas 91 familias de entrenamiento y 27 de validación;
en este nuevo conjunto, la MSE del modelo inicial pasó de 0,008149 a 0,003743 en la mejor
época, la 38. No es una comparación directa con la MSE del conjunto anterior.

El candidato ampliado mantuvo 13/13 tácticas y cumplió 18/19 criterios públicos a 1.500 ms.
La comparación de desarrollo terminó con dos victorias, cuatro derrotas y dos partidas
truncadas: tampoco aporta evidencia suficiente para sustituir el campeón. No se publicó.
Los informes están en `.ai-lab/autonomous-20261025/direct-expanded-v1/`.

## Residuo sobre material y profesor de búsqueda congelado

`material-residual-v1` utiliza la base versionada `material-fortress-v1`: valor de las unidades,
bonificaciones de material aéreo y munición, y 7.500 puntos por HP de Fortaleza. La red añade
una corrección antisimétrica escalada. Los terminales siguen siendo exactos; el suplemento
ranged no se vuelve a sumar, aunque la selección táctica continúa activa. El total puede superar
10.000 puntos. Las etiquetas restan esta base del valor completo del profesor antes de recortar
el residuo. El contrato exige la base, escala, antisimetría e `includesRangedValue: true` explícitos.

```powershell
pnpm exec node scripts/ai/direct-data.mjs --input .ai-lab/trayectorias-desarrollo.jsonl --model src/ai-models/hex-value.bin --output .ai-lab/material-distill.jsonl --target material-residual-v1 --residual-scale 2000 --successors-per-position 4
```

El primer conjunto material conservó las 33.103 posiciones; ninguna etiqueta residual se recortó.
Su auditoría reprodujo trayectorias y ramas y verificó todas las características, bases y etiquetas.
La mejor época de destilación fue la 10, con MSE residual de validación 0,006089 (156 puntos RMSE).
Esa pérdida usa otra escala y otro objetivo: no es comparable directamente con la pérdida de
la red directa. En los mismos 108 estados y 1.265 sucesores del diagnóstico anterior, el error
de los cambios de valor bajó a 66,5 puntos y las discrepancias de signo a 5/834.

El modelo completo pasó 12/13 tácticas públicas y obtuvo 3 victorias, 2 derrotas, 2 tablas y un
corte en desarrollo. Se ensayaron factores de corrección fijos 0, 0,25, 0,5, 0,75 y 1. El 0,5
recuperó 13/13 tácticas y 18/19 criterios, pero en desarrollo obtuvo 2 victorias, 3 derrotas,
2 tablas y un corte. Ninguno aporta evidencia suficiente para publicar. Estos ensayos de ocho
partidas conservan las reglas originales de sus familias; dos usan tablas automáticas históricas.
La paridad Python/JS y Worker del candidato calibrado pasó en Edge con error máximo 1,37×10⁻¹²
y suma cero exacta. La medición de valoración completa sobre 108 estados fue 2,15 veces más
rápida en este ordenador; no mide la velocidad de la búsqueda completa ni demuestra fuerza.

El siguiente reanálisis utiliza explícitamente el campeón congelado como profesor neuronal
de búsqueda, con 15.000 ms, profundidad máxima 9 y mínimo completado 3. Los bytes y hash del
profesor forman parte de la identidad de reanudación. El esquema material es V2 y las etiquetas
son `(valor de búsqueda - base material) / 2000`, recortadas a [-1,1]. El desenlace de la trayectoria
solo se registra cuando procede del motor; no se mezcla retrospectivamente en esa etiqueta.

```powershell
pnpm exec node scripts/ai/reanalyze.mjs --input .ai-lab/trayectorias-desarrollo.jsonl --output .ai-lab/material-search.jsonl --target material-residual-v1 --teacher-model src/ai-models/hex-value.bin --budget-ms 15000 --probe-budget-ms 1000 --depth 9 --minimum-depth 3
```

Este modo requiere entradas declaradas de desarrollo. La fusión exige bases y profesores
compatibles y mantiene familias completas en cada trabajador. El modo clásico predeterminado
conserva su objetivo y etiquetado anteriores. Una búsqueda más profunda del campeón aporta
nuevas estimaciones, no etiquetas de verdad independientes ni una garantía de superioridad.

`deep-material-v1/plan.json` fija 1.024 intentos repartidos entre cuatro procesos. Incorpora
16 trayectorias nuevas, generadas tras excluir 344 familias conocidas o reservadas: hay
136 partidas y 134 familias de desarrollo en total. Los pesos distribuidos siguen sin cambios.

Los coeficientes de `material-fortress-v1` están fijados en su propio módulo: ajustar después
otras heurísticas no altera silenciosamente los pesos ya entrenados. La extracción conservó
exactamente 44.134 valoraciones de base sobre 22.067 posiciones y 11.036 valoraciones
muestreadas de modelos clásicos y materiales respecto del runtime de entrenamiento congelado.

También quedó reservado un banco nuevo de 16 finales, agrupados en cuatro familias de
construcción: ocho victorias certificadas en horizonte de tres acciones y ocho en cinco,
sin victoria en el horizonte más corto comprobado. Se seleccionaron por geometría sembrada
y minimax exhaustivo del motor, sin inferencia de modelos. La auditoría repitió todas las pruebas
y descartó solapamiento de tablero con 22.067 posiciones fuente, las 66.206 perspectivas del
conjunto de inicio del estudiante y 25 casos públicos anteriores, incluso ignorando contadores,
reglas y turno y considerando ambas perspectivas. No son 16 observaciones independientes de fuerza.
`deep-material-v1/reservation.json` fija su uso para un estudiante seleccionado antes de evaluarlo,
su comparación con el campeón y su retirada posterior. El torneo confirmatorio sigue siendo necesario.
