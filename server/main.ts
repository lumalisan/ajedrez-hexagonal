import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { createOnlineApp } from './app';
import { OnlineService } from './online-service';
import { PostgresOnlineRepository } from './postgres-repository';

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Falta la variable de servidor ${name}. Consulta docs/multijugador.md.`);
  return value;
}

const pool = new pg.Pool({
  connectionString: required('DATABASE_URL'),
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});
pool.on('error', () => {
  process.stderr.write('Se ha interrumpido una conexión inactiva con PostgreSQL.\n');
});
const auth = createClient(required('SUPABASE_URL'), required('SUPABASE_PUBLISHABLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const service = new OnlineService(new PostgresOnlineRepository(pool));
const app = await createOnlineApp({
  service,
  origin: required('APP_ORIGIN'),
  logger: true,
  async authenticate(token) {
    const { data, error } = await auth.auth.getClaims(token);
    return !error &&
      typeof data?.claims.sub === 'string' &&
      /^[0-9a-f-]{36}$/i.test(data.claims.sub)
      ? data.claims.sub
      : null;
  },
});
let sweeping = false;
const timer = setInterval(() => {
  if (sweeping) return;
  sweeping = true;
  void service
    .tick()
    .catch((error: unknown) => app.log.error(error, 'Clock sweep failed'))
    .finally(() => {
      sweeping = false;
    });
}, 1_000);
timer.unref();
app.addHook('onClose', async () => {
  clearInterval(timer);
  await pool.end();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
await app.listen({
  host: process.env.API_HOST ?? '127.0.0.1',
  port: Number(process.env.API_PORT ?? 3001),
});
