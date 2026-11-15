# Administración de Hexfortia

La ruta `/admin` pide correo y contraseña de una cuenta de Hexfortia. Cada operación privada
verifica la sesión de Supabase y el UUID de esa cuenta en el servidor.

## Activar en Vercel

1. Registra `hexfortia@gmail.com` dentro del juego, selecciona un nombre de usuario y confirma
   el correo. Usa una contraseña exclusiva para Hexfortia. Si la cuenta del juego ya existe,
   puedes usar su flujo de recuperación para cambiarla.
2. En **Supabase → Authentication → Users**, copia el **User UID** de esa cuenta. Las
   instrucciones de [cuentas](cuentas.md) describen la configuración de Supabase Auth.
3. Ejecuta [la migración del panel](../supabase/migrations/202611150001_admin.sql) en **Supabase →
   SQL Editor** como administrador, después de las migraciones anteriores del repositorio.
4. En **Vercel → Settings → Environment Variables**, añade `ADMIN_USER_ID` con ese UUID en
   Production. En local, pon el UUID en `.env.server`. Ambos entornos deben usar el proyecto
   Supabase donde se creó la cuenta correspondiente.
5. Despliega la versión que incluye el panel y abre [Hexfortia · Administración](https://hexfortia.vercel.app/admin).

## Qué datos aparecen

- Estadísticas empieza en 30 días. Compara dos períodos consecutivos de igual duración y
  guarda una visita por sesión del navegador. La medición empieza al activar el panel y solo
  incluye a quienes la aceptaron en la portada. Los porcentajes aparecen cuando hay cobertura
  para ambos períodos. El registro de visitas guarda el identificador del navegador, la fecha
  de la visita y la cuenta asociada si se conoce. [Guía de medición de audiencia de la AEPD](https://www.aepd.es/guias/guia-cookies-analiticas-externas.pdf).
- La tabla de usuarios cuenta las sesiones que pudieron asociarse a su cuenta y las partidas
  terminadas en el servidor o registradas en el historial o progreso sincronizado.
- El historial importa las entradas disponibles en los guardados actuales y conserva las que se
  sincronizan a partir de ese momento. Una partida guardada solo en un dispositivo o que ya
  salió del historial local antes de sincronizarse queda fuera del archivo central. Las entradas
  antiguas que solo incluyen un resumen se pueden consultar en la lista.
- Eliminar una cuenta borra su perfil, progreso y guardados en la nube. Cierra las partidas
  en línea que tenga en curso por abandono y conserva los resultados en línea de sus rivales
  con el nombre anonimizado.
