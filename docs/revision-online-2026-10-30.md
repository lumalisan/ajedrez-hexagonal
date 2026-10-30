# Revisión del multijugador — 30 de octubre de 2026

Revisión del transporte, la sesión observable, los flujos públicos y privados, la API Fastify y
el repositorio PostgreSQL. Conserva el motor como autoridad, las reglas públicas actuales y la
interfaz existente. Las pruebas de navegador utilizan dos clientes independientes, API real y
almacenamiento transaccional en memoria.

## Problemas corregidos

| Problema                                                                                          | Comportamiento actual                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El polling deshabilitaba tablas y sustituía las acciones por «Vista rival».                       | Consultar mantiene la última posición confirmada y sus controles. Solo un envío bloquea las órdenes.                                                                             |
| Se podían acumular confirmaciones mientras una consulta anterior seguía pendiente.                | Un envío queda reservado inmediatamente; las consultas y los envíos repetidos se agrupan.                                                                                        |
| La cola de una sesión anterior podía retrasar una partida nueva.                                  | Al cambiar de sesión se cancela el transporte, se reinicia la cola y se descartan respuestas y avisos antiguos.                                                                  |
| El error desaparecía al comenzar cada reintento.                                                  | Permanece visible hasta recibir una respuesta correcta, con recuperación accesible dentro y fuera de los diálogos.                                                               |
| Los fallos de red podían mostrar mensajes técnicos y Auth podía bloquear la cola indefinidamente. | Mensajes en español y cancelación/tiempo límite de toda la operación, incluida la espera de Auth.                                                                                |
| Los conflictos se recuperaban con la misma espera que un fallo de conexión.                       | Un 409 consulta inmediatamente el estado; las órdenes nunca se reenvían automáticamente. Los demás reintentos espacian las consultas y respetan `Retry-After` hasta 30 segundos. |
| Una revisión debida solo a tablas borraba selección y borrador.                                   | Los cambios de metadatos conservan la orden; los cambios de posición o resultado la retiran.                                                                                     |
| No había feedback persistente para quien proponía tablas.                                         | Se muestra que espera respuesta y se impide enviar otra propuesta mientras exista una pendiente.                                                                                 |
| La búsqueda caducada podía seguir aparentando una espera activa.                                  | Regresa al menú online y explica cómo iniciar otra búsqueda o generar un código nuevo.                                                                                           |
| Cerrar la configuración durante la creación podía dejar una sala oculta.                          | Encola su cancelación; si ya se encontró partida, conserva el emparejamiento.                                                                                                    |
| El reloj se detenía visualmente entre respuestas.                                                 | Se estima su visualización con tiempo monotónico y la referencia del servidor, sin inventar turnos ni resultados.                                                                |
| Cada polling de una partida activa pasaba por el bloqueo global del vestíbulo.                    | Busca su identificador y adquiere únicamente el bloqueo de esa partida, verificando de nuevo pertenencia y salida dentro de la transacción.                                      |
| Lecturas de rivales y Elo tomaban bloqueos de escritura.                                          | Las lecturas no mutantes no reservan filas; la liquidación de Elo conserva su orden estable de bloqueos.                                                                         |
| Las privadas sin reloj se escribían en cada consulta.                                             | Una posición en curso sin reloj no necesita escritura al consultarse.                                                                                                            |
| Los UUID y revisiones malformados podían llegar a la base de datos.                               | La validación de solicitudes ocurre antes de adquirir bloqueos; las órdenes siguen validándose con las acciones legales del motor.                                               |
| Un campo `name` añadido a una consulta podía modificar el perfil del jugador.                     | Solo los comandos de entrada a partidas actualizan su nombre.                                                                                                                    |
| Repetir rendición alteraba innecesariamente la revisión de un resultado cerrado.                  | La rendición terminal y la confirmación de salida son idempotentes. Quien ya salió no puede enviar nuevas órdenes a esa partida.                                                 |
| El límite por IP podía bloquear a varios jugadores de una misma red.                              | El tráfico autenticado tiene un límite de 300 solicitudes/minuto por identidad verificada. Los fallos de autenticación se limitan separadamente por IP.                          |
| Una respuesta con `status` válido pero contenido dañado podía entrar en la sesión.                | Se validan estados, campos y registros reproducibles antes de entregarlos a la sesión.                                                                                           |

La decisión de evitar bloqueos para lecturas y conservar un orden consistente al modificar varios
jugadores sigue las recomendaciones de [PostgreSQL sobre bloqueos y deadlocks](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-DEADLOCKS).
La cancelación distingue abandono y vencimiento del tiempo de espera según los contratos de
[AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static).

## Regresiones y comprobaciones

- Sesión: polling lento, selección, borrador, doble confirmación, conflictos, errores persistentes,
  cambio de sesión, caducidad y cancelación de salas, reloj con desfase y cambio de hora local.
- Transporte: autorización, respuestas incompletas, registro dañado, red interrumpida, cancelación
  durante Auth, Auth sin respuesta y estados 401/403/409/429/503.
- Sesión caducada: la recuperación manual abre el acceso a la cuenta conservando la posición.
- Servicio: órdenes simultáneas sobre la misma revisión, pertenencia, salida, resultados,
  liquidación única, validación HTTP y aislamiento del límite entre jugadores con la misma IP.
- Navegador: privadas y públicas con dos clientes en 1440×900 y 390×844; consulta retenida,
  interrupción de conexión, reintento conservando borrador, acuerdo de tablas, rendición y salida.
- Inspección visual de reconexión y controles; regresión para impedir que el aviso colapse el tablero.
- Comprobaciones del proyecto: tipos, ESLint, Vitest, compilación, arranque ESM para Vercel,
  interfaz general y Axe en escritorio/móvil.

Vitest: 1105 pruebas aprobadas y 2 omitidas. La compilación conserva el aviso de tamaño de
chunks superiores a 500 kB; no impide generar el build.

## Alcance de la verificación

Las pruebas locales no utilizan la base de datos ni las cuentas de producción. La concurrencia
funcional se prueba con el repositorio en memoria, que serializa transacciones; eso no demuestra
ausencia de contención o deadlocks con carga real en PostgreSQL. La revisión de SQL y de sus
órdenes de bloqueo complementa estas pruebas.

El limitador de Fastify utiliza memoria por instancia. No representa una cuota distribuida entre
funciones Vercel: el control de abuso a escala debe verificarse en la infraestructura desplegada.
Las migraciones y los secretos existentes no cambian en esta revisión.
