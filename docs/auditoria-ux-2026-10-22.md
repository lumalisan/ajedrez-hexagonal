# Auditoría de UX · 22 de octubre de 2026

Revisión del código y de los recorridos de Hexfortia en escritorio (1440 × 900) y móvil
(390 × 844), con mejoras aplicadas sobre la interfaz existente.

## Resultado

La interfaz mantiene una identidad coherente y permite completar los recorridos principales.
Las oportunidades más claras estaban en explicar las consecuencias de una elección, distinguir
guardar de rendirse, y hacer legibles y accesibles los controles secundarios.

Se han conservado las reglas, los guardados, la arquitectura de sesión, el tablero, los modos
actuales y las preferencias. No se han añadido dependencias ni recuperado pantallas descartadas.

Valoración técnica orientativa después de la intervención, sobre la rúbrica de Impeccable:

| Dimensión           | Valoración | Evidencia y límites                                                                                                     |
| ------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Accesibilidad       | 3/4        | Axe, teclado, foco y controles nativos; pendiente una sesión con lector de pantalla real.                               |
| Rendimiento         | 3/4        | Renderer persistente y ventanas cargadas bajo demanda; el build conserva el aviso de un bloque JS superior a 500 kB.    |
| Adaptación          | 3/4        | Flujos comprobados en escritorio y móvil; la suite general también cubre 320 px y apaisado compacto.                    |
| Tokens y coherencia | 3/4        | Controles compartidos y tokens; el CSS histórico todavía mezcla estilos de varias etapas.                               |
| Integridad          | 4/4        | Se conserva el lenguaje visual del producto y la autoridad del motor; detector sin hallazgos en los archivos revisados. |
| Total               | 16/20      | Buena base; esta puntuación es una valoración de ingeniería, no una certificación WCAG ni una prueba con usuarios.      |

## Cobertura

| Área                           | Revisión                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inicio y elección de modo      | Jerarquía, disponibilidad, invitado, texto y recorrido de vuelta.                                                                                                   |
| Configuración de partida       | Bando, dificultad, vida, relojes, formación y vista previa.                                                                                                         |
| Partida                        | Selección, órdenes, confirmación, cámara, teclado y ventanas flotantes; suite general de interacción.                                                               |
| Final y continuidad            | Guardar y salir, retomar, rendirse, resultado, historial y repetición.                                                                                              |
| Aprendizaje                    | Reglamento y navegación de lectura; revisión del tutorial y comprobaciones existentes de su acceso.                                                                 |
| Preferencias                   | Sonido, controles, accesibilidad, guardar/cancelar e importación/exportación existentes.                                                                            |
| Perfil, logros y clasificación | Navegación, estados vacíos, guardado local/cuenta y accesibilidad con Axe.                                                                                          |
| Cuenta y juego en línea        | Revisión de formularios, estados de conexión y consecuencias de rendirse en el código. No se ha creado una cuenta ni disputado una partida real entre dos clientes. |
| Producción sin conexión        | Build y prueba del service worker, recursos, pesos neuronales y apertura de ventanas diferidas sin red.                                                             |

## Mejoras aplicadas y cómo probarlas

Los problemas corregidos son P2 (fricción o ambigüedad) salvo los marcados como P3 (detalle de
presentación). No se encontraron bloqueos P0 o P1 en los recorridos locales comprobados.

| N.º | Problema y mejora                                                                                                                                                                                                       | Prueba manual                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | «Abandonar partida» no distinguía guardar de perder. La cabecera muestra «Guardar y salir» en local/IA y «Rendirse y salir» en línea. La confirmación de rendición en línea usa el estilo de acción destructiva.        | Crea una partida local, pulsa «Guardar y salir», revisa el aviso y confirma. Debe aparecer en Continuar partida. En una partida en línea, comprueba que la salida explica que se concede la victoria al rival. |
| 2   | Una partida terminada seguía pasando por la confirmación de salida de una partida en curso. Ahora ofrece «Volver al inicio» directamente.                                                                               | Ríndete en local, cierra el resultado y pulsa «Volver al inicio». No debe pedir guardar una partida terminada.                                                                                                 |
| 3   | Los niveles de IA solo tenían nombre. Ahora incluyen ayuda contextual y, cuando corresponde, el presupuesto de cálculo por turno.                                                                                       | Nueva partida → Individual. Alterna Fácil, Medio, Difícil, Experto y Neuronal; comprueba que la ayuda cambia.                                                                                                  |
| 4   | La vida de la Fortaleza no explicaba el número de impactos necesarios.                                                                                                                                                  | Cambia sus puntos de vida entre 1 y 3. La explicación debe mostrar uno o tres impactos respectivamente.                                                                                                        |
| 5   | «Solo críticas» y «Rápida» no anticipaban qué órdenes se ejecutaban inmediatamente. Ahora describen su comportamiento y las excepciones que siempre requieren confirmación.                                             | Ajustes → Confirmación de órdenes. Alterna las tres opciones y lee la ayuda; prueba una partida con cada una. Las reglas de ejecución son las existentes.                                                      |
| 6   | Ajustes e historial tenían textos de 9–11 px. Se han ampliado las etiquetas y ayudas a 13–14 px. Los deslizadores de volumen tienen un área de 44 px de alto y anuncian porcentajes.                                    | Revisa Ajustes e Historial desde el móvil. Cambia el volumen con ratón, dedo y flechas del teclado.                                                                                                            |
| 7   | Los ajustes no ofrecían un botón inferior para descartar el formulario en escritorio. Ahora incluyen «Cancelar» y mantienen las acciones visibles al desplazarse.                                                       | Cambia Alto contraste y pulsa Cancelar. Reabre: debe conservar el valor anterior. Repite usando Guardar cambios: debe conservar el nuevo.                                                                      |
| 8   | Los controles por gestos y teclado eran difíciles de descubrir. Hay una sección desplegable «Cómo controlar el tablero» en Ajustes.                                                                                     | Despliega la ayuda. Vuelve al tablero, dale foco y prueba U, Mayús+U, C, H, L e Intro.                                                                                                                         |
| 9   | Las ventanas de consulta podían ocultar el hecho de que el tiempo seguía consumiéndose. Ajustes, Reglas, Perfil y Clasificación muestran un aviso durante partidas con reloj en marcha.                                 | Crea una partida local de 20 minutos y abre Reglas o Ajustes. Debe verse el aviso también en móvil. No debe aparecer al abrir las mismas ventanas desde el inicio.                                             |
| 10  | Para continuar leyendo el manual había que volver al índice. Ahora cada sección ofrece enlaces a la anterior y la siguiente, restableciendo desplazamiento y foco en el título.                                         | Reglas → llega al final de una sección → pulsa el enlace siguiente. Debe empezar arriba y mostrar la sección correspondiente. Prueba también el recorrido inverso.                                             |
| 11  | Los diálogos compartían un contenedor que podía conservar el desplazamiento. Ahora se restablece al entrar.                                                                                                             | Abre Ajustes, desplázate al final, cierra y vuelve a abrir. Debe empezar por el título, con el foco allí.                                                                                                      |
| 12  | Las partidas del mismo día se distinguían solo por jugadores y órdenes. Ahora las listas muestran fecha y hora. Los estados vacíos ofrecen «Nueva partida».                                                             | Guarda dos partidas el mismo día y revisa Continuar. Termina una y revisa Historial. En un navegador sin resultados, usa el botón del historial vacío para crear una partida.                                  |
| 13  | P3: pequeños detalles de navegación y texto. Esc vuelve de la elección de modo al menú y restaura el foco; se corrige «1 partida pendiente» y se habla de dispositivo en el modo local.                                 | Abre Nueva partida y pulsa Esc. Debes volver al menú y poder activar Nueva partida con Intro.                                                                                                                  |
| 14  | P3: la clasificación decía que el progreso se guardaba en el navegador incluso con cuenta. El texto ahora distingue las dos situaciones. La barra de repetición también describe su posición para lectores de pantalla. | Revisa Clasificación como invitado y con una cuenta existente. En una repetición, enfoca la barra de posición con un lector de pantalla.                                                                       |

## Verificación reproducible

- `pnpm test:types`: contratos de cliente y servidor.
- `pnpm lint`: proyecto completo.
- `pnpm test`: 60 archivos, 818 pruebas.
- `pnpm build`: producción y tipos; conserva el aviso de tamaño de bloque JS.
- `pnpm test:ui`: suite general, con escritorio, móvil y pantallas compactas.
- `pnpm test:a11y`: 89 vistas y 2641 comprobaciones de reglas, sin incidencias graves o críticas;
  ampliado con historial vacío, navegación del manual, aviso de reloj y ayuda de controles.
- `pnpm test:ux`: nueva regresión de recorridos en 1440 × 900 y 390 × 844; comprueba cancelación y persistencia de ajustes, foco, retorno al inicio, reloj, continuidad y ausencia de errores de ejecución. Guarda capturas en la carpeta temporal del sistema.
- `pnpm test:offline`: recursos de producción, modelo neuronal y ventanas diferidas sin red.

## Límites y seguimiento

- Las pruebas automáticas de accesibilidad no sustituyen el uso con lector de pantalla ni una
  investigación con jugadores nuevos. No se afirma conformidad WCAG completa.
- El acceso real a una cuenta, los conflictos entre dispositivos y una partida en línea con dos
  jugadores requieren los servicios configurados y una sesión de prueba específica. Sus cambios
  de esta intervención son de presentación; no se ha alterado autenticación ni protocolo de red.
- El aviso de tamaño del bloque principal sigue presente. Dividir más código requiere medir
  carga y respuesta en dispositivos lentos antes de elegir una nueva distribución de módulos.
- El CSS conserva capas históricas. Se han modificado las reglas implicadas sin convertir esta
  auditoría en una reescritura del sistema visual.
