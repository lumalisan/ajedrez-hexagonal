import Fastify, { type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { OnlineRequest } from '../src/online-contracts.js';
import { OnlineError, type OnlineService } from './online-service.js';
import type { AccountService } from './account-service.js';
import type { CloudRequest } from '../src/cloud-contracts.js';
import type { RankingService } from './ranking-service.js';
import type { RankingMode, RankingPeriod } from '../src/ranking-contracts.js';
import { isUuid, type AdminService } from './admin-service.js';

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
  'ready',
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
  admin?: AdminService;
  adminUserId?: string;
  deleteManagedAccount?: (id: string) => Promise<void>;
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
  await app.register(rateLimit, { global: false, max: 300, timeWindow: '1 minute' });
  const verifiedPlayers = new WeakMap<FastifyRequest, string>();
  const playerLimit = app.createRateLimit({
    keyGenerator: (request) => `player:${verifiedPlayers.get(request)}`,
  });
  const authFailureLimit = app.createRateLimit({
    max: 60,
    keyGenerator: (request) => `auth:${request.ip}`,
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof OnlineError) {
      if (error.retryAfterSeconds > 0) reply.header('Retry-After', error.retryAfterSeconds);
      return reply.code(error.statusCode).send({ error: error.message });
    }
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
    const failures = await authFailureLimit(request, { increment: false });
    if (!failures.isAllowed && failures.isExceeded)
      throw new OnlineError(
        'Demasiados intentos de acceso. Espera un minuto y reintenta.',
        429,
        failures.ttlInSeconds,
      );
    const user = await options.authenticate(authorization.slice(7));
    if (!user) {
      await authFailureLimit(request);
      throw new OnlineError('La sesión ha caducado. Vuelve a intentarlo.', 401);
    }
    verifiedPlayers.set(request, user.id);
    const limit = await playerLimit(request);
    if (!limit.isAllowed && limit.isExceeded)
      throw new OnlineError(
        'Demasiadas solicitudes. Espera un momento y reintenta.',
        429,
        limit.ttlInSeconds,
      );
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
  async function requireAdmin(request: FastifyRequest) {
    const user = await identity(request);
    if (user.isAnonymous || !options.adminUserId || user.id !== options.adminUserId)
      throw new OnlineError('Esta cuenta no tiene acceso a la administración.', 403);
    if (!options.admin) throw new OnlineError('La administración no está disponible.', 503);
    return options.admin;
  }
  app.get<{
    Querystring: {
      view?: string;
      period?: string;
      sort?: string;
      direction?: string;
      page?: string;
      id?: string;
    };
  }>('/api/admin', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const admin = await requireAdmin(request);
    const {
      view,
      period = '30d',
      sort = 'registeredAt',
      direction = 'desc',
      page = '0',
      id,
    } = request.query;
    switch (view) {
      case 'session':
        return { ok: true };
      case 'traffic':
        return admin.traffic(period);
      case 'users':
        return admin.users(sort, direction, page);
      case 'profile':
        if (!isUuid(id) || !options.rankings) throw new OnlineError('Perfil no disponible.', 404);
        return options.rankings.ownProfile(id);
      case 'history':
        return admin.history(page);
      case 'replay':
        if (typeof id !== 'string' || id.length > 145)
          throw new OnlineError('Repetición no disponible.', 404);
        return admin.replay(id);
      default:
        throw new OnlineError('Consulta de administración no válida.');
    }
  });
  app.delete<{ Querystring: { id?: string } }>('/api/admin', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    await requireAdmin(request);
    if (!isUuid(request.query.id)) throw new OnlineError('Cuenta no válida.');
    if (!options.deleteManagedAccount)
      throw new OnlineError('La eliminación no está disponible.', 503);
    await options.deleteManagedAccount(request.query.id);
    return reply.code(204).send();
  });
  app.get('/api/visit', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { enabled: Boolean(options.admin && options.adminUserId) };
  });
  app.post<{ Body: { id?: unknown; visitorId?: unknown } }>(
    '/api/visit',
    { bodyLimit: 512, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (request.headers.origin !== options.origin)
        throw new OnlineError('Origen no permitido.', 403);
      if (!options.admin || !options.adminUserId) return reply.code(204).send();
      const { id, visitorId } = request.body ?? {};
      const user = request.headers.authorization ? await identity(request) : null;
      await options.admin.visit(id, visitorId, user && !user.isAnonymous ? user.id : null);
      return reply.code(204).send();
    },
  );
  return app;
}
