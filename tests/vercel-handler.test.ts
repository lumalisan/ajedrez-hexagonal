import { createServer, type Server } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOnlineApp } from '../server/app';
import { OnlineService } from '../server/online-service';
import { createOnlineRuntime } from '../server/runtime';
import { createVercelHandler } from '../server/vercel-handler';
import { MemoryOnlineRepository } from './helpers/online-repository';

const playerId = '00000000-0000-4000-8000-000000000001';
const origin = 'https://hexfortia.example';
const apps: FastifyInstance[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  for (const app of apps.splice(0)) await app.close();
  vi.unstubAllEnvs();
});

async function appFactory() {
  const app = await createOnlineApp({
    service: new OnlineService(new MemoryOnlineRepository()),
    origin,
    trustProxy: true,
    authenticate: async (token) => (token === 'valid' ? playerId : null),
  });
  apps.push(app);
  return app;
}

async function bridge(factory = appFactory) {
  const handler = createVercelHandler(factory);
  const server = createServer((request, response) => void handler(request, response));
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP address');
  return `http://127.0.0.1:${address.port}`;
}

describe('API de Vercel con streams HTTP reales', () => {
  it('comparte el arranque concurrente y procesa JSON, autenticación y respuestas completas', async () => {
    const factory = vi.fn(appFactory);
    const base = await bridge(factory);
    const [health, search] = await Promise.all([
      fetch(`${base}/api/health`),
      fetch(`${base}/api/online`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid',
          Origin: origin,
        },
        body: JSON.stringify({ kind: 'search', name: 'Jugador' }),
      }),
    ]);
    expect(factory).toHaveBeenCalledOnce();
    expect(health.status).toBe(200);
    expect(health.headers.get('cache-control')).toBe('no-store');
    expect(await health.json()).toEqual({ ok: true });
    expect(search.status).toBe(200);
    expect(search.headers.get('cache-control')).toBe('no-store');
    expect(await search.json()).toMatchObject({ status: 'searching', elo: 1000 });
  });

  it('conserva los límites y las comprobaciones HTTP al ejecutarse como función', async () => {
    const base = await bridge();
    const call = (body: string, headers = {}) =>
      fetch(`${base}/api/online`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body,
      });
    expect((await call('{"kind":"state"}')).status).toBe(401);
    expect(
      (
        await call('{"kind":"state"}', {
          Authorization: 'Bearer valid',
          Origin: 'https://other.example',
        })
      ).status,
    ).toBe(403);
    expect((await call('{', { Authorization: 'Bearer valid' })).status).toBe(400);
    expect(
      (
        await call(JSON.stringify({ kind: 'search', name: 'x'.repeat(17_000) }), {
          Authorization: 'Bearer valid',
        })
      ).status,
    ).toBe(413);
  });

  it('no filtra detalles del arranque y permite reintentar tras un fallo', async () => {
    const factory = vi
      .fn(appFactory)
      .mockRejectedValueOnce(new Error('private database credential'));
    const base = await bridge(factory);
    const failed = await fetch(`${base}/api/health`);
    expect(failed.status).toBe(503);
    expect(failed.headers.get('cache-control')).toBe('no-store');
    expect(await failed.text()).not.toContain('private database credential');
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('reutiliza las variables públicas de Vite al configurar la función, sin conectar la BD para health', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@127.0.0.1:1/test');
    vi.stubEnv('APP_ORIGIN', origin);
    const { app } = await createOnlineRuntime({ serverless: true });
    apps.push(app);
    const health = await app.inject({ url: '/api/health' });
    expect(health.json()).toEqual({ ok: true });
    vi.stubEnv('DATABASE_URL', '');
    await expect(createOnlineRuntime({ serverless: true })).rejects.toThrow('DATABASE_URL');
  });
});
