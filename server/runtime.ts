import { createClient } from '@supabase/supabase-js';
import { attachDatabasePool } from '@vercel/functions';
import pg from 'pg';
import { createOnlineApp } from './app.js';
import { OnlineService } from './online-service.js';
import { PostgresOnlineRepository } from './postgres-repository.js';

function required(name: string, fallback?: string): string {
  const value = process.env[name] || (fallback ? process.env[fallback] : undefined);
  if (!value)
    throw new Error(`Falta la variable de servidor ${name}. Consulta docs/multijugador.md.`);
  return value;
}

/** One reusable pool per instance; all match and queue state belongs to PostgreSQL. */
export async function createOnlineRuntime({ serverless = false } = {}) {
  // Validate all configuration before allocating resources. Public settings can be shared with Vite.
  const databaseUrl = required('DATABASE_URL');
  const origin = required('APP_ORIGIN');
  const auth = createClient(
    required('SUPABASE_URL', 'VITE_SUPABASE_URL'),
    required('SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: serverless ? 3 : 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
    allowExitOnIdle: serverless,
  });
  if (serverless) attachDatabasePool(pool);
  pool.on('error', () => {
    process.stderr.write('Se ha interrumpido una conexión inactiva con PostgreSQL.\n');
  });
  const service = new OnlineService(new PostgresOnlineRepository(pool));
  try {
    const app = await createOnlineApp({
      service,
      origin,
      logger: true,
      trustProxy: serverless,
      async authenticate(token) {
        const { data, error } = await auth.auth.getClaims(token);
        return !error &&
          typeof data?.claims.sub === 'string' &&
          /^[0-9a-f-]{36}$/i.test(data.claims.sub)
          ? data.claims.sub
          : null;
      },
    });
    app.addHook('onClose', async () => {
      await pool.end();
    });
    return { app, service };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
