import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { OnlineRequest } from '../src/online-contracts.js';
import { OnlineError, type OnlineService } from './online-service.js';

const REQUEST_KINDS = [
  'state',
  'search',
  'create-private',
  'join-private',
  'cancel',
  'action',
  'resign',
  'finish',
];

export async function createOnlineApp(options: {
  service: OnlineService;
  authenticate: (token: string) => Promise<string | null>;
  origin: string;
  logger?: boolean;
  trustProxy?: boolean;
}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 16_384,
    requestTimeout: 15_000,
    trustProxy: options.trustProxy ?? false,
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof OnlineError)
      return reply.code(error.statusCode).send({ error: error.message });
    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode < 500
    )
      return reply
        .code(error.statusCode)
        .send({ error: 'Solicitud no válida o demasiados intentos. Inténtalo de nuevo.' });
    request.log.error(error, 'Online request failed');
    return reply
      .code(503)
      .send({ error: 'El servicio en línea no está disponible. Inténtalo de nuevo.' });
  });
  app.get('/api/health', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { ok: true };
  });
  app.post('/api/online', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.headers.origin && request.headers.origin !== options.origin)
      throw new OnlineError('Origen no permitido.', 403);
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ') || authorization.length > 8192)
      throw new OnlineError('Inicia sesión para jugar en línea.', 401);
    const userId = await options.authenticate(authorization.slice(7));
    if (!userId) throw new OnlineError('La sesión ha caducado. Vuelve a intentarlo.', 401);
    const body = request.body;
    if (
      !body ||
      typeof body !== 'object' ||
      !('kind' in body) ||
      typeof body.kind !== 'string' ||
      !REQUEST_KINDS.includes(body.kind)
    )
      throw new OnlineError('Solicitud no válida.');
    // Remaining discriminated fields are validated by the application service.
    return options.service.request(userId, body as OnlineRequest);
  });
  return app;
}
