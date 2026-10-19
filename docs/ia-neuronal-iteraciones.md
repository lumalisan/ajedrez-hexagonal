# Iteraciones tras el piloto

La referencia es Experto clásico: evaluación equilibrada, 15.000 ms por turno,
profundidad máxima 9 y reglas del motor. Su selección de acciones y presupuesto no se reducen.
Los candidatos, sus pesos y su perfil de búsqueda se identifican en cada informe.

## Protocolo fijado antes de medir la segunda versión

- Desarrollo: datos del piloto (semilla 1802) y derrotas anteriores (927451).
- Nuevas etiquetas: búsquedas del profesor de hasta profundidad 5 y 1.000 ms por posición.
- Candidato: valoración clásica más corrección neuronal acotada a 2.000 puntos; entrenamiento
  de residuos respecto a la valoración estática, en lugar de aprender toda la valoración desde cero.
- Perfil opcional `pvs-history`: PVS con nueva búsqueda cuando una cota mejora, historial de
  órdenes tranquilas, reutilización exacta del hash de repeticiones y selección del mejor valor.
  No modifica las reglas. La referencia conserva su perfil clásico y su variedad habitual.
- Cribado de desarrollo: semilla 460219, partidas emparejadas y presupuesto reducido, identificado
  como tal. Sirve para descartar candidatos, no para anunciar victoria frente al Experto completo.
- Primera evaluación independiente: semilla 840621, disposiciones 3 y 5, bandos intercambiados,
  Fortaleza de 2 HP y límites completos de Experto. El modelo se congela durante la evaluación.
- Una versión se considera prometedora si termina con más victorias que derrotas en ese lote,
  sin contabilizar partidas truncadas como tablas. Es un criterio práctico de iteración;
  no equivale a una estimación de Elo ni a una prueba estadística de superioridad general.

Los informes incluyen el perfil y permiten `--ablation` para medir el perfil del candidato
con evaluación clásica, separando la contribución del buscador de la corrección neuronal.
La semilla de evaluación de una versión descartada no se presentará después como prueba nueva
de una versión ajustada con conocimiento de ese resultado.

La segunda versión se entrenó con 1.532 muestras residuales, 1.208 para entrenamiento y
324 para validación por partidas completas. La mejor época fue la quinta; la MSE retenida
fue 0,01669 frente a 0,01738 al no aplicar ninguna corrección. La corrección aprendida es modesta;
la prueba de juego evaluará el conjunto de corrección y buscador, no solamente la red.
Los vectores de Python coincidieron con Edge con error máximo de 3,42 × 10⁻¹³.

Los torneos largos guardan también el estado de la partida en curso cada cuatro medias jugadas.
Ese checkpoint no cuenta como resultado y conserva acciones, búsquedas y métricas para su revisión.

## Cribado y evaluación completa de v2, 19 de octubre de 2026

El cribado con semilla 460219 terminó con 3 victorias, 0 tablas, 0 derrotas y 1 partida
inconclusa (límite de 120 medias jugadas adicionales). Usó 1.000 ms por búsqueda y profundidad
máxima 9, dos pares, cuatro órdenes de apertura y fortalezas de 1 HP. No equivale al Experto completo.

La evaluación independiente se inicia con los pesos congelados de SHA-256
`7cf6b0203a54a4dc5fedf58f67d125b318dc67bfafae8bd521bf3be96f690ed5`.
Se mantienen la semilla 840621, dos pares, disposiciones 3 y 5 y fortalezas de 2 HP.
Antes de iniciarla se fijan cuatro órdenes de apertura y un máximo de 240 medias jugadas
adicionales por partida, con 15.000 ms y profundidad máxima 9 para ambos rivales.
El informe completo se guarda en `.ai-lab/candidate-v2-expert15s.json`.

El usuario eligió añadir el nivel «Neuronal» y conservar Experto. La integración del selector,
la carga cancelable de pesos y la continuidad de guardados se prepara durante el torneo;
el proceso del torneo ya había cargado el código de búsqueda y no observa cambios de archivos.
El manifiesto `.ai-lab/candidate-v2-expert15s-manifest.json` conserva los hashes de sus fuentes.
Las posteriores adaptaciones de tipos para el nivel nuevo mantienen los mismos parámetros
de búsqueda cuando la estrategia solicita Experto con el evaluador candidato.
Neuronal comparte provisionalmente las recompensas y el rating de juego de Experto (1.800),
sin atribuir ese valor a una estimación empírica de su fuerza.

### Resultado limitado de v2

El primer encuentro alcanzó 244 medias jugadas totales (240 adicionales) sin resultado del
motor, tras unos 60 minutos. Las fortalezas seguían a 2 HP; quedaron 11 piezas.
Se registró como inconcluso. Se detuvo el experimento durante el segundo encuentro,
cuyo checkpoint es parcial y no cuenta como resultado. El lote previsto de cuatro partidas
no se completó y v2 no quedó cualificado. El informe conserva el motivo de la detención.

### v3: simetría y extensión de amenazas

La red residual se vuelve a entrenar con las mismas 1.532 muestras y semilla 20261019,
proyectando su salida como `(red(perspectiva) − red(opuesta)) / 2`.
El gradiente aprende las perspectivas originales emparejadas; la selección de época y la
validación miden la salida proyectada que se usará en el navegador. La mejor época es la octava,
con MSE 0,016280 frente a 0,017383 sin corrección; la MSE de la red sin proyectar es 0,016848.
El SHA-256 de v3 es `ad3df928cda491d9655ec720062a1b0af8c4348d00c0fc306ab0462ed3e24156`.

El perfil `pvs-threats` conserva PVS e historial y amplía la búsqueda de estabilización cuando
se amenaza cualquier HP de Fortaleza. Una prueba recorre todas las defensas legales de un
Capturador y verifica una victoria de dos impactos con el motor; otra comprueba que acercarlo
un hexágono permite contraatacar y que esa posición no se califica como mate.
El primer diagnóstico con un Escudo moviéndose solo fue descartado: el motor no permite
esas órdenes. No se modificaron reglas para sostener aquel diagnóstico.

Antes del cribado de v3 se fija la siguiente evaluación independiente: semilla 631907,
dos pares con disposiciones 3 y 5, cuatro órdenes de apertura, fortalezas de **1 HP**,
240 órdenes adicionales como máximo y los mismos 15.000 ms/profundidad 9 para ambos rivales.
Se prioriza la configuración de vida predeterminada en «Nueva partida», que también se usó
en el duelo original del piloto. El ensayo anterior a 2 HP permanece registrado y no se
presentará este cambio de configuración como una victoria en aquel ensayo.
El cribado usa semilla 501019 y límites reducidos; la continuación del final conocido usa
la posición de v2 y también es desarrollo, nunca una evaluación independiente.

El cribado de v3 terminó con 1 victoria y 3 inconclusas, sin tablas ni derrotas consumadas,
con 500 ms por búsqueda y 120 órdenes adicionales. No establece superioridad: uno de los
encuentros truncados tenía valoración de derrota forzada para el candidato al cortar.
Se conservará esa partida sin adjudicar y la comparación completa usará el límite de 240 órdenes.

La primera partida de evaluación independiente de v3 terminó en **victoria del candidato**
como jugador 0, por destrucción de Fortaleza en la media jugada 193, tras 47,28 minutos.
Ambos rivales usaron 15.000 ms y profundidad máxima 9. La partida con el bando
intercambiado quedó inconclusa al alcanzar el límite de 240 órdenes adicionales. El lote se
detuvo durante la tercera partida para atender los comentarios del usuario sobre las unidades
a distancia: conserva **1 victoria y 1 inconclusa**, sin adjudicar la partida interrumpida ni
la cuarta partida pendiente. El artefacto de v3 se incorpora
al nivel experimental «Neuronal», manteniendo Experto clásico. No se interpreta esta victoria
aislada como una estimación de superioridad general.

## Ajuste de unidades a distancia, 19 de octubre de 2026

Tras probar Neuronal, el usuario indicó que el Caza y el Lanzamisiles participaban poco y que
la IA no atendía suficientemente a los tiradores enemigos. Se conserva el binario v3 y se
añade al perfil `pvs-threats` un suplemento estratégico en `src/ai-ranged.ts`:

- Mayor valor de conservación y supresión para el Caza y los misiles disponibles.
- Despliegue del Lanzamisiles hacia su anillo de tres hexágonos, en lugar de premiar únicamente
  el acercamiento a la Fortaleza. Un lanzador agotado no recibe este incentivo.
- Valoración de amenazas con las celdas de disparo del motor, incluyendo arcos y escudos.
  Cada batería puntúa su mejor blanco y un bono acotado por una segunda amenaza; no se suman
  todas sus víctimas como bajas simultáneas. Esto desincentiva exponer varias unidades al mismo Caza.
- Ordenación de vuelos y desplazamientos útiles antes de recortar alternativas tranquilas
  en los nodos interiores. Se penalizan vuelos a través de zonas de intercepción.

El nivel Experto sigue usando su evaluación y búsqueda clásicas. La opción de diagnóstico
`rangedPlay: false` permite comparar el mismo modelo y perfil sin este suplemento. La ablación
de la arena mantiene las heurísticas tácticas del perfil y omite la corrección neuronal;
el informe identifica el suplemento como `ranged-v1`.

Diez regresiones usan el binario incluido y el motor real. Cubren supresión de un Caza sobre
una unidad terrestre en el mismo hexágono, despliegue del lanzador, avance aéreo sin entrar en
el anillo enemigo, evasión de un tanque amenazado, prioridad de posiciones de tiro, escudos,
munición agotada, intercepción durante el trayecto, simetría y victoria inmediata de Fortaleza.
En el caso de las dos capas, la versión sin suplemento elegía el Embestidor y la nueva el Caza.
Esto valida decisiones concretas, sin establecer un porcentaje global de uso ni fuerza superior.

También se retira el texto de ayuda bajo el selector de dificultad, manteniendo los cinco niveles.
La paridad de las 16 salidas neuronales y las decisiones legales del Worker se verifican de nuevo
en Edge, con ventanas de 1440×900 y 390×844. Las nuevas heurísticas están en el buscador:
la paridad del binario no pretende medirlas ni supone un nuevo entrenamiento.

La evaluación larga anterior corresponde al código y a las reglas congelados en su manifiesto.
Los cambios simultáneos del proyecto en las reglas de orientación requieren una nueva comparación
para atribuir resultados a la combinación actual; no se traslada aquella victoria a este ajuste.

Validación del ajuste: 711 pruebas de Vitest correctas (incluidas las diez nuevas), tipos,
ESLint, compilación y caché offline correctos. La inspección del selector y su auditoría Axe
específica pasan en ambos tamaños. Las suites globales de navegador no terminaron: UI encontró
el puerto 4174 ocupado y Axe se detuvo esperando «Tu perfil», durante cambios simultáneos de
interfaz. No se presentan esas suites globales como aprobadas.
