# Multijugador: Node, Vite y Supabase

El repositorio contiene el cliente React/Vite y una API Node con Fastify. Ambos se despliegan
en un mismo proyecto Vercel: la web como contenido estático y la API como funciones. Supabase aporta
PostgreSQL y Auth. No se necesita una clave `service_role`: el navegador usa una clave publicable
y Node verifica los JWT de Supabase con `getClaims`. La conexión PostgreSQL pertenece exclusivamente
al servidor y utiliza un rol dedicado.

## Separación de responsabilidades

- `src/online-matchmaking.ts`: reglas públicas fijas, sorteo de bandos y ventanas de Elo, sin red ni DOM.
- `src/online-contracts.ts`: solicitudes y respuestas compartidas.
- `src/online-client.ts`: transporte HTTP del multijugador; comparte el SDK de Auth con las
  cuentas. El resto del juego funciona como invitado sin Supabase configurado.
- `api/online.ts`, `api/account.ts` y `api/health.ts`: entradas de Vercel, sin puertos ni intervalos persistentes.
- `server/vercel-handler.ts`: adaptación de streams HTTP y arranque compartido por instancia.
- `server/runtime.ts`: configuración, autenticación y pool PostgreSQL reutilizable; libera conexiones
  inactivas antes de que Vercel suspenda una instancia con `attachDatabasePool`.
- `server/app.ts`: límite HTTP, autenticación, origen, tamaño de cuerpo, límites de solicitudes
  y errores públicos. No acepta identidad ni Elo proporcionados por el cliente.
- `server/online-service.ts`: casos de uso, reserva de rivales, salas, turnos, reloj y resultados.
  Reutiliza `MatchController`, el motor y la identidad canónica; no duplica reglas de combate.
- `server/repository.ts`: contrato transaccional independiente de PostgreSQL.
- `server/postgres-repository.ts`: SQL parametrizado, pool y transacciones con una conexión.
- `supabase/migrations/`: esquema privado, permisos y políticas RLS.

La sesión observable sigue coordinando React. En línea, el cliente propone órdenes y representa
la posición recibida; solo el servidor puede confirmarlas. La revisión de partida impide aplicar
órdenes repetidas o basadas en una posición anterior. No se puede deshacer ni continuar una copia
local como si fuese la partida compartida. Las partidas locales anteriores se conservan.

## Activar en desarrollo

1. Crear un proyecto Supabase y aplicar `supabase/migrations/202610210001_online.sql` con el
   procedimiento habitual de migraciones o el editor SQL. La migración no se ejecuta al arrancar.
2. Asignar una contraseña segura al rol `hexfortia_server` desde una sesión administrativa.
   Guardarla solo en `DATABASE_URL`; no incorporarla a Git ni al frontend. Seleccionar conexión
   directa o session pooler según la conectividad IPv4/IPv6 disponible y exigir TLS con
   verificación del certificado. Para el pooler, usar el nombre de usuario correspondiente al
   proyecto y al rol dedicado que indique Supabase.
   La plantilla incluye `sslrootcert=server/certificates/prod-ca-2021.crt`, el certificado
   público de Supabase guardado en el repositorio. Ejecutar los comandos desde la raíz del proyecto
   para resolver esa ruta. Si Supabase cambia su CA, descargar el certificado vigente desde
   Database Settings → SSL Configuration y actualizar el archivo; mantener `sslmode=verify-full`.
3. Mantener **Anonymous Sign-Ins** para las privadas de clientes anteriores. La interfaz actual
   requiere una cuenta para entrar en «Batalla en línea». Activar las cuentas siguiendo
   [la guía de cuentas](cuentas.md), incluida la segunda migración y el correo. En un servicio público,
   configurar protección CAPTCHA y límites de Auth antes de habilitar registros anónimos masivos.
4. Copiar `.env.example` a `.env.local` y `.env.server.example` a `.env.server`; sustituir los
   ejemplos. `APP_ORIGIN` debe coincidir exactamente con la URL del navegador, incluido el puerto.
   Ambas configuraciones reales están ignoradas por Git.
5. Ejecutar `pnpm dev:server` y, en otra terminal, `pnpm dev`. Vite envía `/api` al puerto 3001.

La base de datos debe contener la migración y usuarios reales de Auth. No existe un modo de
producción que omita la autenticación o sustituya rivales por bots. Las pruebas usan un repositorio
transaccional en memoria y autenticación inyectada, exclusivamente desde los archivos de prueba.

## Desplegar todo en Vercel

1. Mantener el proyecto como **Vite**, con la raíz del repositorio como Root Directory.
   `vercel.json` comprueba el arranque ESM con `pnpm test:vercel` antes de `pnpm build`, salida
   `dist`, funciones Node de hasta 30 segundos y región
   Dublín (cercana al proyecto Supabase actual). No configurar el proyecto como Fastify ni mover
   Root Directory a `server/`: las funciones se detectan en `api/` junto al frontend.
2. En **Settings → Environment Variables**, crear estas variables para **Production**:

   | Variable                        | Valor                                                                             |
   | ------------------------------- | --------------------------------------------------------------------------------- |
   | `VITE_SUPABASE_URL`             | URL del proyecto Supabase.                                                        |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave publicable de Supabase.                                                     |
   | `DATABASE_URL`                  | Conexión PostgreSQL del rol `hexfortia_server`, con contraseña y TLS verificado.  |
   | `APP_ORIGIN`                    | URL exacta del juego, por ejemplo `https://mi-juego.vercel.app`, sin barra final. |

   Las funciones reutilizan las dos variables públicas de Vite si no se proporcionan
   `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` por separado. `DATABASE_URL` solo pertenece al servidor;
   nunca debe tener prefijo `VITE_`. Los nombres `NEXT_PUBLIC_*` no se utilizan en este proyecto.
   No es necesario subir `.env.local` ni `.env.server`.

3. Usar la URL de conexión del pooler de Supabase para el rol dedicado. La conexión verificada
   que funciona en local también puede configurarse en Vercel. Mantener
   `sslmode=verify-full&sslrootcert=server/certificates/prod-ca-2021.crt`:
   `vercel.json` incluye ese certificado público en las funciones. Cada instancia de Vercel
   mantiene como máximo tres conexiones; el estado de las partidas sigue en PostgreSQL.
4. Hacer **Redeploy** después de guardar las variables. Los valores `VITE_*` se incorporan durante
   la compilación. No ejecutar `pnpm start:server` en Vercel ni configurar un proxy hacia localhost;
   las funciones ya reciben `/api/online`, `/api/account` y `/api/health` en el mismo dominio de la web.
5. Abrir `https://TU-DOMINIO/api/health`: debe devolver `{"ok":true}`. Esta comprobación valida el
   arranque y la configuración, pero no abre una conexión a PostgreSQL ni comprueba JWT reales.
   Después crear una privada desde un navegador y entrar con otra identidad desde otro navegador
   o dispositivo. Esto sí comprueba autenticación, permisos, base de datos y comunicación.

Para probar un despliegue Preview contra otra base de datos, configurar sus variables Preview
por separado y hacer coincidir `APP_ORIGIN` con su dominio. La API comprueba el origen exacto;
no acepta todos los dominios `*.vercel.app`. La misma configuración se aplica a dominios propios.
No se necesita otro proveedor Node. La función de cuentas requiere su migración SQL adicional.

## Comportamiento

Buscar partida requiere una cuenta permanente e inicia la búsqueda directamente. La API rechaza
las búsquedas de identidades anónimas aunque un cliente modificado intente enviarlas.
Todas las partidas públicas nuevas usan Fortaleza
con 1 punto de vida, turnos de 30 segundos, tiempo total sin límite y Frente clásico. Los bandos
opuestos se asignan al azar. El servidor aplica estas reglas incluso si un cliente antiguo envía
preferencias o quedan filtros anteriores en la cola; las partidas ya iniciadas conservan sus reglas.
La diferencia de Elo empieza en 200 puntos y se amplía progresivamente hasta 400 durante el primer
minuto, respetando la espera de ambos jugadores.

Las salas privadas usan códigos aleatorios de seis cifras, reservados con una restricción única.
Caducan tras diez minutos y se consumen al entrar el segundo jugador. El creador fija las reglas
y su bando; el invitado recibe el opuesto. Se admite turno sin límite. Las privadas no modifican
Elo, para evitar que salas pactadas alteren la clasificación.

La cola utiliza una concesión de presencia de 45 segundos. Una búsqueda sin actualizaciones
caduca; un cierre normal cancela la reserva. Ante una carrera entre cancelar y emparejar, una
partida ya creada se recupera en ambos clientes. Cerrar la pestaña durante una partida no pausa
el reloj: el servidor lo controla y realiza una jugada con la IA al caducar un turno, respetando
la derrota tras el tercer agotamiento. Rendirse concede la victoria al rival desde cualquier
turno. El resultado y el cambio de Elo se guardan en la misma transacción una sola vez.

## Concurrencia y despliegue

Las reservas de cola y sala se serializan con un bloqueo asesor transaccional. Cada partida tiene
su propio bloqueo y fila bloqueada al actualizarse: varios procesos Node pueden compartir la
base de datos sin duplicar emparejamientos, movimientos o liquidaciones de Elo. No hay colas
ni salas en la memoria del proceso que se pierdan al reiniciar una función.

La sincronización usa POST autenticado cada segundo; los reintentos tras fallo esperan tres
segundos. Esto evita infraestructura adicional para la primera versión por turnos y permite
recuperar una partida desde el menú en línea. El contrato admite evolucionar a SSE/WebSocket
sin cambiar los casos de uso. La cola global y el barrido secuencial son límites deliberados
de capacidad: medir carga y latencias antes de ampliar, dividir el barrido por lotes y reemplazar
el bloqueo global de cola si el volumen lo exige. Los límites HTTP actuales son por IP y proceso;
un despliegue público con varias réplicas debe aplicar también límites compartidos en el proxy.

En Vercel no se ejecuta un intervalo permanente ni se necesita Cron para mantener los turnos.
Cada consulta o jugada reconstruye el reloj desde los tiempos guardados, resuelve los vencimientos
pendientes y confirma el resultado en la transacción. Mientras haya un navegador conectado, su
consulta cada segundo actualiza la partida. Si ambos se desconectan, el tiempo sigue transcurriendo;
las jugadas automáticas y el resultado se materializan en la siguiente consulta, sin tiempo extra.
El Elo se liquida entonces una sola vez. Una nueva instancia puede reconstruirlo todo desde la BD.

En desarrollo, `server/main.ts` sigue ofreciendo el servicio persistente y un barrido cada segundo,
como comodidad local. Las funciones reutilizan el mismo caso de uso y el mismo motor, pero no
importan ese punto de entrada. Los límites por IP del plugin son por instancia, no un límite global
compartido; Vercel Firewall puede complementar la protección en el borde. La función confía en
los encabezados de proxy de Vercel para identificar la IP; el servidor local no confía en proxies.

Los replays y los resultados en línea se conservan, pero esta entrega no incorpora clasificación
global, invitación a revancha, oferta de tablas entre dispositivos ni
recompensas XP/logros en línea. Esos controles no deben resolver localmente una partida de red.

## Verificación y límites de esta entrega

Las pruebas cubren reglas públicas fijas, filtros antiguos ignorados, reservas simultáneas, códigos
consumidos y caducados, permisos, revisiones, jugadas ilegales, reloj del servidor y Elo idempotente.
También cubren el adaptador de Vercel con streams HTTP reales, cuerpos malformados y grandes,
arranques concurrentes, fallos de inicialización y recuperación tras un arranque en frío sin barrido.
`pnpm test:types` comprueba además los imports de la API con NodeNext. `pnpm test:vercel` transpila
la API y sus dependencias locales a JavaScript y las arranca con Node nativo, sin Vite ni `tsx`.
Esto detecta imports ESM sin extensión que funcionarían en desarrollo pero fallarían en Vercel.
La validación real de la migración, los permisos del rol, los JWT y la conexión entre dispositivos
requiere configurar un proyecto Supabase. Los dobles de repositorio no sustituyen esa prueba de
integración con PostgreSQL. Antes de publicar, ejecutar esa integración y probar una partida
entre dos navegadores con identidades distintas, reconexión, agotamiento del reloj y reinicio de Node.

Referencias: [Fastify](https://fastify.dev/docs/latest/Guides/Getting-Started/),
[conexiones PostgreSQL en Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres),
[claves publicables y secretas](https://supabase.com/docs/guides/api/api-keys),
[verificación JWT](https://supabase.com/docs/reference/javascript/auth-getclaims),
[identidades anónimas](https://supabase.com/docs/guides/auth/auth-anonymous),
[transacciones de node-postgres](https://node-postgres.com/features/transactions),
[funciones Node de Vercel](https://vercel.com/docs/functions/runtimes/node-js),
[gestión de pools en Vercel](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#attachdatabasepool).
