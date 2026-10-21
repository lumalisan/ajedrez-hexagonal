# Cuentas y progreso en Supabase

El juego permite continuar como invitado o crear una cuenta con correo y contraseña. Supabase
Auth gestiona contraseñas, sesiones, confirmación de correo y recuperación de acceso.
La web y la API siguen alojadas juntas en Vercel; no hacen falta nuevas variables de entorno.

## Activar en el proyecto existente

1. En **Supabase → SQL Editor → New query**, ejecutar el contenido de
   [`202610210002_accounts.sql`](../supabase/migrations/202610210002_accounts.sql).
   Requiere haber aplicado antes `202610210001_online.sql` y ejecutarse como administrador,
   no como el rol restringido `hexfortia_server`. Crea `hexfortia.accounts` y sus permisos;
   no cambia las partidas ni los usuarios existentes.
2. En **Authentication → URL Configuration**, establecer **Site URL** en
   `https://hexfortia.vercel.app`. Añadir esa misma URL a **Redirect URLs**. Para desarrollo,
   añadir también `http://localhost:5173` y/o `http://127.0.0.1:5173`, según se utilicen.
   Los enlaces de confirmación y recuperación vuelven a la raíz de la aplicación.
3. En **Authentication → Sign In / Providers → Email**, habilitar correo y contraseña,
   permitir registros y mantener la confirmación de correo. Establecer un mínimo de
   8 caracteres para la contraseña. Mantener **Anonymous Sign-Ins** para compatibilidad con
   privadas de clientes anteriores. La interfaz actual exige cuenta para entrar en «Batalla
   en línea»; una identidad anónima no permite buscar partidas públicas ni guardar en la nube.
4. Por decisión del usuario, mantener **Enable custom SMTP** desactivado y utilizar el envío
   predeterminado de Supabase. No hacen falta una cuenta Gmail, un dominio de correo ni nuevas
   credenciales. Probar con el correo de un miembro del equipo del proyecto: el proveedor
   predeterminado solo admite esas direcciones y actualmente limita el proyecto a dos correos
   por hora, incluyendo confirmaciones y recuperación. Con esta configuración, el registro de
   jugadores ajenos al equipo queda restringido por Supabase.
5. Desplegar el código y comprobar registro, confirmación del correo, acceso, recuperación de
   contraseña y cambio de dispositivo contra el proyecto real.

No hay que exponer el esquema `hexfortia` mediante Data API ni crear una clave `service_role`.
La migración y los correos reales no se verifican mediante los dobles de las pruebas locales.

## Comportamiento del jugador

- **Invitado:** conserva las mismas claves y datos anteriores del navegador. Puede jugar en
  local y contra Hexfortia. «Batalla en línea» muestra el requisito de cuenta y abre directamente
  el acceso o registro; sus modalidades solo aparecen después de iniciar sesión.
- **Cuenta:** sincroniza perfil, XP, logros, estadísticas, preferencias, historial, partidas
  locales pendientes y escenarios. El Elo público pertenece al servidor y se recupera con
  la identidad de Auth, incluso al cambiar de navegador.
- **Registro:** ofrece importar el progreso del invitado, manteniendo su copia original.
  Solo se importa en una cuenta sin guardado previo. Para importar, completar el acceso desde
  el navegador donde se eligió la opción. El Elo público no se importa desde un dato local.
- **Cerrar sesión:** vuelve a la copia del invitado. Cada cuenta tiene su propia caché local;
  cambiar de cuenta no mezcla los guardados. Los cambios pendientes tras un fallo se conservan
  en ese dispositivo y se reintentan al volver a entrar.
- **Sin conexión:** una cuenta con caché puede continuar en modos locales. El perfil muestra
  el estado del guardado y permite reintentar; recuperar la conexión también lo reintenta.
  Sin una primera copia descargada, se pide reintentar antes de empezar una partida.
- **Dos dispositivos:** las revisiones impiden que una subida antigua sustituya cambios de
  otro dispositivo. Ante un conflicto se ofrecen «Conservar la nube» y «Conservar este
  dispositivo». No se fusionan historiales automáticamente.

## Arquitectura y límites

`account-controller.ts` coordina identidad, carga y subidas con un segundo de espera para
agrupar cambios. Antes de cambiar la identidad, libera la `GameSession`; React crea una sesión
nueva después de preparar sus datos. Las respuestas asíncronas de otra cuenta se descartan.
`player-storage.ts` conserva los formatos anteriores y separa las claves por identidad.
`supabase-client.ts` comparte una instancia del SDK entre cuentas y multijugador.

`POST /api/account` verifica el JWT y rechaza usuarios anónimos. El identificador se toma
del token verificado, nunca del cuerpo enviado. `AccountService` limita las claves y el tamaño
del documento (3 MB), valida el JSON, normaliza el Elo con `hexfortia.players` y comprueba la revisión
en una transacción bloqueada por cuenta. La tabla usa RLS y solo permite acceso al rol dedicado
del servidor. Contraseñas, tokens y telemetría no forman parte del guardado.

El progreso de los modos locales procede del cliente; guardarlo en nube no lo convierte en
un resultado competitivo verificado. El Elo público solo cambia al resolver partidas públicas
en el servidor. Los guardados conservan sus versiones y compatibilidad existentes.

`pnpm test` cubre aislamiento, importación, conflictos, red fallida, respuestas tardías, cierre
de sesión durante una subida y protección del Elo. `pnpm test:online` prueba formularios,
restricción del invitado, guardado y recuperación sin caché de cuenta, además del multijugador,
en escritorio y móvil con Axe. También comprueba el foco, mostrar y ocultar contraseña,
conservar el formulario ante errores y distinguir el fondo exterior de clics y arrastres
en el interior del modal. Auth y PostgreSQL se sustituyen en esas pruebas; antes de abrir
el registro hay que completar el paso 5 contra Supabase.

Referencias: [registro](https://supabase.com/docs/reference/javascript/auth-signup),
[URL de retorno](https://supabase.com/docs/guides/auth/redirect-urls),
[SMTP de Supabase](https://supabase.com/docs/guides/auth/auth-smtp),
[identidades anónimas](https://supabase.com/docs/guides/auth/auth-anonymous).
