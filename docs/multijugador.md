# Multijugador: Node, Vite y Supabase

El repositorio contiene el cliente React/Vite y un servidor Node con Fastify. Supabase aporta
PostgreSQL y Auth. No se necesita una clave `service_role`: el navegador usa una clave publicable
y Node verifica los JWT de Supabase con `getClaims`. La conexión PostgreSQL pertenece exclusivamente
al servidor y utiliza un rol dedicado.

## Separación de responsabilidades

- `src/online-matchmaking.ts`: reglas públicas fijas, sorteo de bandos y ventanas de Elo, sin red ni DOM.
- `src/online-contracts.ts`: solicitudes y respuestas compartidas.
- `src/online-client.ts`: autenticación y transporte HTTP del navegador, inicializados al entrar
  en línea. El resto del juego funciona sin Supabase configurado.
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
3. Habilitar **Anonymous Sign-Ins** en Supabase Auth. La identidad queda guardada en ese navegador.
   Esta primera versión permite jugar sin formulario de registro; recuperar el mismo Elo en otro
   dispositivo requiere vincular una cuenta, flujo todavía pendiente. En un servicio público,
   configurar protección CAPTCHA y límites de Auth antes de habilitar registros anónimos masivos.
4. Copiar `.env.example` a `.env.local` y `.env.server.example` a `.env.server`; sustituir los
   ejemplos. `APP_ORIGIN` debe coincidir exactamente con la URL del navegador, incluido el puerto.
   Ambas configuraciones reales están ignoradas por Git.
5. Ejecutar `pnpm dev:server` y, en otra terminal, `pnpm dev`. Vite envía `/api` al puerto 3001.

La base de datos debe contener la migración y usuarios reales de Auth. No existe un modo de
producción que omita la autenticación o sustituya rivales por bots. Las pruebas usan un repositorio
transaccional en memoria y autenticación inyectada, exclusivamente desde los archivos de prueba.

## Comportamiento

Buscar partida inicia la búsqueda directamente. Todas las partidas públicas nuevas usan Fortaleza
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
base de datos sin duplicar emparejamientos, movimientos o liquidaciones de Elo. El barrido de
relojes se ejecuta cada segundo y respeta esos mismos bloqueos. No hay colas o salas en la
memoria del proceso que se pierdan al reiniciar Node.

La sincronización usa POST autenticado cada segundo; los reintentos tras fallo esperan tres
segundos. Esto evita infraestructura adicional para la primera versión por turnos y permite
recuperar una partida desde el menú en línea. El contrato admite evolucionar a SSE/WebSocket
sin cambiar los casos de uso. La cola global y el barrido secuencial son límites deliberados
de capacidad: medir carga y latencias antes de ampliar, dividir el barrido por lotes y reemplazar
el bloqueo global de cola si el volumen lo exige. Los límites HTTP actuales son por IP y proceso;
un despliegue público con varias réplicas debe aplicar también límites compartidos en el proxy.

Desplegar el build de Vite como contenido estático y Node como servicio persistente, próximos a
la región de Supabase. El proxy del mismo origen debe enviar `/api/*` a Node; HTTPS es obligatorio
en producción. Configurar `API_HOST=0.0.0.0` solo si la plataforma necesita escuchar fuera de
localhost. `pnpm start:server` ejecuta el servicio TypeScript con `tsx`; el host necesita las
dependencias de producción, incluido `tsx`. No basta con subir
`dist/`: el build de Vite no compila ni despliega el backend. `/api/health` confirma que Node
responde; no sustituye una comprobación de conectividad con Auth y PostgreSQL.

Los replays y los resultados en línea se conservan, pero esta entrega no incorpora clasificación
global, vinculación de cuentas, invitación a revancha, oferta de tablas entre dispositivos ni
recompensas XP/logros en línea. Esos controles no deben resolver localmente una partida de red.

## Verificación y límites de esta entrega

Las pruebas cubren reglas públicas fijas, filtros antiguos ignorados, reservas simultáneas, códigos
consumidos y caducados, permisos, revisiones, jugadas ilegales, reloj del servidor y Elo idempotente.
La validación real de la migración, los permisos del rol, los JWT y la conexión entre dispositivos
requiere configurar un proyecto Supabase. Los dobles de repositorio no sustituyen esa prueba de
integración con PostgreSQL. Antes de publicar, ejecutar esa integración y probar una partida
entre dos navegadores con identidades distintas, reconexión, agotamiento del reloj y reinicio de Node.

Referencias: [Fastify](https://fastify.dev/docs/latest/Guides/Getting-Started/),
[conexiones PostgreSQL en Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres),
[claves publicables y secretas](https://supabase.com/docs/guides/api/api-keys),
[verificación JWT](https://supabase.com/docs/reference/javascript/auth-getclaims),
[identidades anónimas](https://supabase.com/docs/guides/auth/auth-anonymous),
[transacciones de node-postgres](https://node-postgres.com/features/transactions).
