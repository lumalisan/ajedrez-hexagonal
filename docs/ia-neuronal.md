# Laboratorio de IA neuronal

La red aprende a valorar posiciones; el motor conserva las reglas y la búsqueda alfa-beta
elige acciones legales. La evaluación clásica sigue siendo la predeterminada, incluido Experto.
El candidato no se promociona automáticamente por tener un error de entrenamiento bajo.
El artefacto experimental incluido corresponde a v3; su primer encuentro con los límites completos
terminó en victoria por destrucción de Fortaleza. El lote comparativo continúa registrado en
[las iteraciones](ia-neuronal-iteraciones.md), sin atribuir fuerza general a una sola partida.

## Arquitectura y ejecución

`src/ai-neural.ts` contiene un codificador puro y una red dispersa `5183 → 64 → 32 → 1`:
333.889 parámetros Float32, aproximadamente 1,34 MB más metadatos. Usa ReLU en las capas ocultas y
una salida `tanh × 10000`, reservando las puntuaciones terminales al motor. Es una primera red
inspirada en NNUE: suma únicamente las entradas activas; todavía recalcula esa suma por posición.
No implementa acumuladores incrementales ni cuantización.

Las entradas representan los 91 hexágonos, ambos bandos, las dos capas, las orientaciones,
munición, vida de Fortaleza y contexto global: turno, primer daño, progreso, repetición y reglas.
La perspectiva del jugador 1 rota coordenadas y orientaciones 180 grados. Los resúmenes del
historial son aproximados; la comprobación exacta de las tablas permanece en el motor.

El binario HXNN incluye versión, esquema, dimensiones y procedencia del entrenamiento. Se
rechazan archivos incompatibles, truncados o con pesos no finitos. No contiene código ejecutable.
La inferencia es síncrona y usa arrays numéricos dentro del Worker. No necesita GPU, servicios de
inferencia ni una dependencia de machine learning en la SPA.

`new WorkerAiStrategy(bytes)` permite suministrar pesos explícitamente.
`await WorkerAiStrategy.createNeuralCandidate()` carga el candidato incluido en el build y valida
su formato. La estrategia conserva cancelación y límites de tiempo; su respaldo local también
usa el evaluador solicitado. El Worker se sigue liberando al terminar cada búsqueda.
El modelo se emite con nombre versionado y entra en la precarga offline de Vite.

El nivel «Neuronal» solicita ese modelo de forma explícita, mantiene hasta 15 segundos y
profundidad máxima 9 y usa la misma configuración del candidato evaluado. Experto conserva
su evaluación y selección clásicas. Los pesos se cargan una vez por sesión de estrategia;
cambiar de partida o cancelar durante la carga impide que se cree un Worker obsoleto.
Si la carga falla, se avisa y Experto resuelve ese turno; el siguiente vuelve a intentar la carga.
El nivel se guarda en el registro y comparte provisionalmente las recompensas y el rating
de juego de Experto. Ese rating no es una medición de fuerza del modelo.

## Generación de datos

```powershell
pnpm ai:generate --games 48 --budget-ms 250 --depth 3 --max-plies 160 --seed 1802 --output .ai-lab/positions.jsonl
```

El generador usa el motor TypeScript real, las disposiciones actuales 3 y 5, fortalezas de 1–3 HP,
exploración legal y semillas registradas. Emite dos perspectivas por posición, con etiquetas
opuestas del profesor equilibrado, y guarda aperturas, acciones y resultados para auditar los datos.
Solo etiqueta búsquedas con alguna profundidad completada. La semilla controla apertura y variedad;
el corte por tiempo depende del ordenador y puede cambiar la profundidad alcanzada.

Los datos son JSONL con cabecera versionada, índices binarios dispersos y registros por partida.
El valor del profesor se normaliza con `tanh(score/10000)`. Una partida truncada tiene resultado
desconocido (`null`), nunca una tabla inventada. Los límites reducidos del profesor deben figurar
en cualquier interpretación del modelo: imitar búsquedas cortas no demuestra superar Experto.
El generador rechaza sobrescribir datos salvo que se indique `--overwrite`.

## Entrenamiento fuera del navegador

Se necesita Python con NumPy; `AI_PYTHON` selecciona el ejecutable si `python` no está disponible.
Las dependencias están en `scripts/ai/requirements.txt` y deben instalarse en un entorno virtual.
PyTorch es opcional: `--backend torch` selecciona su implementación CPU de la misma arquitectura.
El backend predeterminado NumPy permite entrenar sin instalar PyTorch.

```powershell
pnpm ai:train --input .ai-lab/positions.jsonl --output src/ai-models/hex-value.bin --epochs 80 --seed 20261018
```

El entrenador utiliza AdamW, clipping de gradientes, partición estable por partidas completas,
early stopping y restauración de la mejor época. Mezcla valoración del profesor (70 %) y resultado
(30 %) cuando hay desenlace conocido; en partidas inconclusas usa solo el profesor.
Las dos perspectivas y las posiciones de una misma partida permanecen en la misma partición.

Se generan el binario, un informe `.training.json` y 16 vectores `.parity.json` para verificar
Python frente a JavaScript. El informe conserva semillas, hash del dataset, configuración,
partición, pérdidas, baselines y diagnóstico de posiciones idénticas compartidas entre particiones.
Ese solapamiento puede hacer optimista el error de validación, aunque no se compartan partidas.
Los datos, checkpoints y pruebas temporales viven en `.ai-lab/`, excluido de Git.

### Corrección residual y perfil de búsqueda

El segundo candidato conserva la valoración clásica y aprende una corrección:
`valor = clásico + tanh(red) × residualScale`. Su escala de 2.000 puntos limita el efecto
de la red, mientras el motor sigue teniendo la última palabra sobre victorias y tablas.
Así la red aprende diferencias tácticas del profesor en lugar de reconstruir desde cero
el valor material y las amenazas ya representadas por la heurística.

```powershell
pnpm ai:relabel --input .ai-lab/pilot-positions-v2.jsonl --arena .ai-lab/arena-expert15s.json --output .ai-lab/residual-v2.jsonl --positions 768 --budget-ms 1000 --depth 5 --seed 280319 --residual-scale 2000
pnpm ai:train --input .ai-lab/residual-v2.jsonl --output .ai-lab/candidate-v3.bin --epochs 120 --batch-size 128 --patience 16 --seed 20261019 --teacher-weight 1 --learning-rate 0.0005 --weight-decay 0.001 --antisymmetric
```

El reetiquetado reproduce las acciones con el motor, da prioridad a las derrotas de desarrollo
y registra la profundidad realmente completada. La partición sigue separando partidas completas.
El informe del entrenador compara también la MSE con una corrección nula.

`--antisymmetric` requiere perspectivas 0 y 1 emparejadas por partida y media jugada,
con etiquetas opuestas. La corrección desplegada es la semidiferencia de ambas predicciones:
el valor de un bando es el negativo del otro. El optimizador aprende las salidas originales;
la selección de época y las pérdidas informadas usan la proyección. `rawValidation` conserva
también el error de la red sin proyectar. Los vectores de paridad verifican esa red original;
las pruebas del evaluador verifican la proyección y la suma cero.

Los primeros metadatos residuales solicitan el perfil `pvs-history`: búsqueda con ventanas estrechas y
nueva búsqueda al mejorar una cota, historial de acciones tranquilas y selección del mejor valor
en la raíz. El hash de repeticiones se acelera conservando exactamente su cálculo anterior.
Los modelos originales siguen usando su evaluación completa y el perfil clásico.
La comparación de un candidato residual mide tanto su red como ese perfil; `--ablation`
permite repetir el ensayo con el perfil del candidato y valoración clásica.
La exportación antisimétrica solicita `pvs-threats`, que añade defensas tranquilas a la búsqueda
de estabilización ante amenazas al primer HP de Fortaleza. Los perfiles anteriores siguen disponibles.

## Verificación del navegador y comparación con Experto

```powershell
pnpm ai:browser
pnpm ai:arena --model src/ai-models/hex-value.bin --pairs 4 --budget-ms 15000 --depth 9 --max-plies 240 --seed 927451 --output .ai-lab/arena-expert.json
```

La prueba de navegador usa Edge o Chrome (`PLAYWRIGHT_BROWSER_PATH`), compara los vectores
de Python con la inferencia real, mide su coste y solicita una acción legal al Worker neuronal.
Prueba viewports 1440×900 y 390×844 en el mismo ordenador; eso no mide un móvil físico.
`pnpm test:offline`, después del build, comprueba también la disponibilidad de los pesos sin red.

Cada par del torneo reutiliza exactamente la apertura e intercambia los bandos. Ambos rivales usan
los límites de Experto, personalidad equilibrada, mismas reglas, semilla y presupuesto. El primer
piloto cambió solo el evaluador; los candidatos posteriores pueden solicitar un perfil de búsqueda
propio, que se identifica en el informe. `--ablation` permite comprobar ese perfil sin la red.
La semilla del torneo debe ser distinta de la usada para los datos.
Los límites predeterminados son los actuales de Experto: 15 s por turno y profundidad máxima 9.
Una prueba con `--budget-ms 250` sirve para depurar, pero no equivale a ese nivel completo.
La generación, entrenamiento y torneo deben ejecutarse de forma secuencial para reducir la
competencia por CPU durante las mediciones.

El informe se guarda tras cada partida e incluye V/T/D, inconclusas por separado, acciones,
estados finales, hash del modelo, profundidad completada y tiempos. El intervalo de puntuación
Wilson es aproximado: las tablas aportan medio punto y las partidas emparejadas están correlacionadas.
No constituye por sí solo una prueba estadística para promocionar el modelo.
Un par completo de 240 medias jugadas puede consumir hasta dos horas con 15 s por búsqueda.
Una decisión de fuerza necesita suficientes partidas terminadas, aperturas variadas y validación
independiente de los ajustes del modelo.

## Comprobaciones del código

```powershell
pnpm test:types
pnpm lint
pnpm test
pnpm build
pnpm ai:test-training
pnpm ai:browser
pnpm test:offline
```

El entrenador opcional PyTorch requiere sus propias comprobaciones cuando se utilice; el primer
piloto puede ejecutarse con NumPy. Las pruebas sintéticas verifican el entrenamiento y el formato,
pero no prueban fuerza de juego. Los resultados de un piloto deben comunicarse por separado de
las pruebas de corrección.

## Primer candidato, 18 de octubre de 2026

El primer binario se entrenó con NumPy 2.3.5 en CPU, semilla 20261018, sobre 3.852 muestras de
48 partidas generadas con semilla 1802. El profesor usó profundidad principal 1, 250 ms,
96 medias jugadas adicionales, seis de apertura y muestreo cada dos turnos. Es un piloto de
infraestructura, con etiquetas de búsqueda corta, no un modelo entrenado para garantizar mayor fuerza.

De las 48 partidas, 35 quedaron inconclusas; 730 muestras tienen desenlace conocido. Se reservaron
10 partidas (770 muestras) para validación y se entrenó con 38 (3.082 muestras). No se encontraron
vectores de entrada idénticos entre particiones. El error de validación pasó de 0,06103 a 0,05471;
la predicción neutra obtiene 0,05666. La mejor época fue la primera y el early stopping detuvo
el entrenamiento tras 13 épocas. La pequeña mejora frente al baseline neutro aconseja ampliar
diversidad y calidad de los datos antes de esperar una mejora de fuerza.

En Edge 155, los 16 vectores de paridad de Python coincidieron con error máximo
2,85 × 10⁻¹³. Una medición corta de 2.000 inferencias dispersas dio 0,0067–0,0081 ms por evaluación
en este ordenador, excluyendo codificación del estado, búsqueda y carga del modelo. Es una
medición orientativa con calentamiento JIT, no una garantía de rendimiento ni una prueba en móvil.
El Worker tomó decisiones legales y se verificó la carga del binario desde la caché offline.

El primer duelo usó un par con la misma apertura de seis órdenes, semilla independiente 927451,
disposición 3 y fortalezas de 1 HP. Ambos rivales tuvieron los límites actuales de Experto:
15.000 ms y profundidad máxima 9. El modelo quedó congelado durante todo el ensayo.

| Bando del candidato | Resultado del candidato | Media jugada final | Motivo              |
| ------------------- | ----------------------- | ------------------ | ------------------- |
| Jugador 0           | Derrota                 | 54                 | Fortaleza destruida |
| Jugador 1           | Derrota                 | 83                 | Fortaleza destruida |

La evaluación clásica ganó **2–0**, sin tablas ni partidas truncadas. La profundidad principal
completada media fue 3,52 para la clásica y 3,76 para la neuronal; estas medias proceden de posiciones
distintas y no son un benchmark aislado de velocidad. El duelo consumió aproximadamente 31 minutos.
El resultado de un solo par no permite estimar fuerza general ni Elo, pero no aporta motivo para
promocionar este candidato. Experto conserva la evaluación clásica.

El [informe del piloto](ia-neuronal-piloto-2026-10-18.json) conserva hashes de código/modelo,
configuración, entrenamiento, navegador y métricas del duelo. El registro completo de acciones,
búsquedas y estados está en `.ai-lab/arena-expert15s.json`. Los siguientes experimentos deberían
mejorar la diversidad y profundidad de las etiquetas, usar nuevas aperturas de evaluación y
acumular más partidas antes de cambiar la IA predeterminada.

Las [iteraciones posteriores](ia-neuronal-iteraciones.md) prueban una red residual y un perfil de
búsqueda opcional. Los modelos del primer piloto mantienen su formato y comportamiento anteriores.
