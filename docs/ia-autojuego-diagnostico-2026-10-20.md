# Diagnóstico del primer ciclo, 20 de octubre de 2026

Se detuvo el experimento `.ai-lab/selfplay-learning-20261019` durante el primer torneo contra
el campeón, con seis partidas inconclusas. No podía llegar al 80% de partidas terminadas del
filtro aunque todas las restantes terminaran. El checkpoint parcial posterior queda conservado.
No se actualizó el binario del juego. El experimento conserva su manifiesto de fuentes anterior;
el código nuevo no debe reanudarlo como si fuera el mismo ensayo.

## Hallazgos medidos

- Se generaron 24 partidas: 10 con desenlace y 14 inconclusas, 5.166 muestras en total.
  Ambas perspectivas de una posición cuentan como dos muestras, no como posiciones independientes.
- 1.808 muestras tenían resultado conocido. Se reservaron 5 partidas completas (986 muestras)
  para validación; no había vectores idénticos entre entrenamiento y validación.
- El error de entrenamiento bajó de 0.28158 en la época 1 a 0.00587 en la 12; el de validación
  empeoró de 0.27378 en la inicialización a 0.40735 en la época 12. Es un patrón de sobreajuste,
  no un fallo en el cálculo del early stopping. Se exportó la inicialización, correctamente
  seleccionada por ese criterio, pero el ciclo no debía haberla enviado al torneo largo.
- 1.580 etiquetas de 5.166 (30,6%) estaban saturadas cerca de ±1. Mezclar un 25% del resultado
  con una valoración normalizada y convertirla de nuevo a puntos podía superar una corrección
  de 2.000 puntos incluso desde posiciones aproximadamente equilibradas. Se asignaba además
  el mismo resultado a posiciones muy alejadas del desenlace.
- Cada ronda reinicializaba los pesos. Se perdía el evaluador ya entrenado al empezar el nuevo
  candidato. El optimizador entrenaba las salidas sin proyectar, mientras que validación e
  inferencia usaban la diferencia antisimétrica de ambas perspectivas.

La evidencia muestra varios problemas que se refuerzan. No permite atribuir todo el fracaso
a un único parámetro ni concluir que más datos, por sí solos, lo resolverían.

## Ajustes implementados

Las etiquetas `bounded-outcome-v2` parten de la diferencia entre búsqueda y baseline. El resultado
aporta como máximo 500 puntos, con descuento `0.98 ^ distancia al final`; la corrección total sigue
limitada a 2.000. Las 5.166 muestras se pudieron reetiquetar sin repetir las búsquedas: quedaron
64 saturadas (1,24%). No se eliminaron ejemplos difíciles para mejorar artificialmente el error.

El entrenador admite `--initialize-model`, valida el contrato HXNN y continúa los pesos, reiniciando
AdamW. En modo antisimétrico mantiene pares completos en los minibatches y deriva el gradiente de
la salida proyectada. Se redujo el learning rate de 0.001 a 0.0002 y se aumentó weight decay a 0.001.
Los informes incluyen estadísticas de etiquetas separadas por entrenamiento y validación.

Se añadieron tres filtros antes de promocionar: mejora de validación frente a la inicialización
y al baseline sin corrección, cribado corto con resultados y parada anticipada de torneos cuyo
filtro ya sea matemáticamente imposible. Una pérdida de validación mejor no sustituye un torneo.

## Comparaciones de desarrollo

Se reutilizaron exactamente las partidas y el split por semilla 1747037217, con 30 épocas máximas,
paciencia 8 y el gradiente proyectado corregido. Son experimentos de desarrollo, no evaluación
independiente después de seleccionar ajustes con conocimiento de esos datos.

| Etiquetas                           | Inicialización  | Mejor época | MSE inicial | MSE retenida | MSE sin corrección |
| ----------------------------------- | --------------- | ----------: | ----------: | -----------: | -----------------: |
| Anteriores                          | Aleatoria       |           0 |    0.273779 |     0.273779 |           0.264304 |
| Acotadas y descontadas              | Aleatoria       |           0 |    0.023517 |     0.023517 |           0.020578 |
| Acotadas y descontadas              | Campeón vigente |           3 |    0.015452 |     0.015151 |           0.020578 |
| Solo búsqueda, resultado con peso 0 | Campeón vigente |           0 |    0.012582 |     0.012582 |  Consultar informe |

El candidato con resultados acotados y continuación de pesos mejoró un 1,95% respecto a su propia
inicialización y un 26,4% frente al baseline sin corrección, sobre el mismo conjunto de etiquetas.
Las MSE de filas con etiquetas distintas no miden la misma tarea y no deben compararse como
porcentajes de mejora de fuerza. El ensayo sin resultados no mejoró su propia inicialización.

Los binarios, datasets e informes están en `.ai-lab/selfplay-repair-20261020/`. `bounded-warm.bin`
es el candidato de desarrollo, no el modelo distribuido.

Reproducción de las etiquetas y el entrenamiento:

```powershell
pnpm exec node scripts/ai/relabel-selfplay.mjs --input .ai-lab/selfplay-learning-20261019/round-0001/training.jsonl --output .ai-lab/repair-reproduction.jsonl
pnpm ai:train --input .ai-lab/repair-reproduction.jsonl --output .ai-lab/repair-reproduction.bin --initialize-model .ai-lab/selfplay-learning-20261019/initial.bin --epochs 30 --patience 8 --seed 1747037217 --learning-rate 0.0002 --weight-decay 0.001 --teacher-weight 1 --antisymmetric
```

## Límites y siguiente evaluación

El cribado de desarrollo usa semilla 830207, dos pares, disposiciones 3 y 5, fortalezas de 1 HP,
250 ms y profundidad máxima 5, con 120 órdenes adicionales por partida. Sus resultados se guardan
en `screening.json`: terminó con cuatro inconclusas, sin victorias ni derrotas consumadas.
No superó el cribado y no se inicia otro torneo largo ni se cambia el modelo del juego.
Un resultado truncado se conserva como inconcluso. Ese presupuesto no equivale
al Experto de 15 segundos y no permite publicar un candidato por sí solo.

La escasez de partidas independientes y los finales sin resolver siguen siendo limitaciones.
Antes de ampliar cómputo conviene reunir más trayectorias y finales variados y medir regresiones
tácticas con el motor. No se cambian reglas ni se inventan tablas o victorias para mejorar métricas.
