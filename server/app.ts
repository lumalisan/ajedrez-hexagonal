import Fastify, { type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { OnlineRequest } from '../src/online-contracts.js';
import { OnlineError, type OnlineService } from './online-service.js';
import type { AccountService } from './account-service.js';
import type { CloudRequest } from '../src/cloud-contracts.js';
import type { RankingService } from './ranking-service.js';
import type { RankingMode, RankingPeriod } from '../src/ranking-contracts.js';

export interface AuthIdentity {
  id: string;
  isAnonymous: boolean;
}

const REQUEST_KINDS = [
  'state',
  'search',
  'create-private',
  'join-private',
  'cancel',
  'action',
  'offer-draw',
  'respond-draw',
  'resign',
  'finish',
];

export async function createOnlineApp(options: {
  service: OnlineService;
  authenticate: (token: string) => Promise<AuthIdentity | null>;
  accounts?: AccountService;
  deleteAccount?: (id: string) => Promise<void>;
  rankings?: RankingService;
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
  app.get<{ Querystring: { mode?: string; period?: string; page?: string; playerId?: string } }>(
    '/api/ranking',
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const user = await identity(request);
      if (user.isAnonymous)
        throw new OnlineError(
          'Inicia sesión con una cuenta para consultar la clasificación completa.',
          403,
        );
      if (!options.rankings)
        throw new OnlineError('La clasificación compartida no está configurada.', 503);
      if (request.query.playerId !== undefined)
        return request.query.playerId === 'me'
          ? options.rankings.ownProfile(user.id)
          : options.rankings.profile(request.query.playerId);
      const { mode = 'online', period = 'month', page = '0' } = request.query;
      if (!/^\d+$/.test(page)) throw new OnlineError('Página no válida.');
      return options.rankings.list({
        mode: mode as RankingMode,
        period: period as RankingPeriod,
        page: Number(page),
      });
    },
  );
  async function identity(request: FastifyRequest): Promise<AuthIdentity> {
    if (request.headers.origin && request.headers.origin !== options.origin)
      throw new OnlineError('Origen no permitido.', 403);
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ') || authorization.length > 8192)
      throw new OnlineError('Inicia sesión para jugar en línea.', 401);
    const user = await options.authenticate(authorization.slice(7));
    if (!user) throw new OnlineError('La sesión ha caducado. Vuelve a intentarlo.', 401);
    return user;
  }
  app.post('/api/online', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const user = await identity(request);
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
    return options.service.request(user.id, body as OnlineRequest, !user.isAnonymous);
  });
  app.post('/api/account', { bodyLimit: 3_100_000 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const user = await identity(request);
    if (user.isAnonymous)
      throw new OnlineError('Inicia sesión con una cuenta para guardar en la nube.', 403);
    if (!options.accounts)
      throw new OnlineError('El guardado en la nube no está configurado.', 503);
    return options.accounts.request(user.id, request.body as CloudRequest);
  });
  app.delete('/api/account', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const user = await identity(request);
    if (user.isAnonymous) throw new OnlineError('Inicia sesión para eliminar tu cuenta.', 403);
    if (!options.deleteAccount)
      throw new OnlineError('La eliminación de cuentas no está configurada.', 503);
    await options.deleteAccount(user.id);
    return reply.code(204).send();
  });
  return app;
}
