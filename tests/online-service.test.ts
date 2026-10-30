import { describe, expect, it, vi } from 'vitest';
import { createOnlineApp } from '../server/app';
import { OnlineService } from '../server/online-service';
import { getAllLegalActions } from '../src/engine';
import { replayRecord } from '../src/match-record';
import type { OnlineState, PrivateMatchSettings } from '../src/online-contracts';
import { MemoryOnlineRepository } from './helpers/online-repository';

const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const c = '00000000-0000-4000-8000-000000000003';
const settings: PrivateMatchSettings = {
  faction: 'conservationist',
  fortressHp: 3,
  turnSeconds: '',
  totalSeconds: '',
  layout: 5,
};
function playing(state: OnlineState) {
  if (state.status !== 'playing') throw Error('No match');
  return state;
}
function privateWaiting(state: OnlineState) {
  if (state.status !== 'private-waiting') throw Error('No room');
  return state;
}

describe('servicio multijugador con almacenamiento transaccional', () => {
  it('consulta partidas activas sin bloquear el vestíbulo ni reservar jugadores de lectura', async () => {
    const repository = new MemoryOnlineRepository();
    const service = new OnlineService(repository, () => 1000);
    await service.request(a, { kind: 'search', name: 'a' });
    const match = playing(await service.request(b, { kind: 'search', name: 'b' }));
    const transaction = vi.spyOn(repository, 'transaction');
    const results = await Promise.all([a, b].map((id) => service.request(id, { kind: 'state' })));
    expect(results.map((state) => playing(state).matchId)).toEqual([match.matchId, match.matchId]);
    expect(transaction.mock.calls.map(([lock]) => lock)).toEqual([
      `match:${match.matchId}`,
      `match:${match.matchId}`,
    ]);
  });

  it('confirma una sola orden ante dos envíos simultáneos de la misma revisión', async () => {
    const repository = new MemoryOnlineRepository();
    const service = new OnlineService(repository, () => 1000);
    await service.request(a, { kind: 'search', name: 'a' });
    const match = playing(await service.request(b, { kind: 'search', name: 'b' }));
    const state = replayRecord(match.record);
    const actor = repository.matches.get(match.matchId)!.players[state.activePlayer];
    const request = {
      kind: 'action' as const,
      matchId: match.matchId,
      revision: match.revision,
      action: getAllLegalActions(state)[0],
    };
    const results = await Promise.allSettled([
      service.request(actor, request),
      service.request(actor, request),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(repository.matches.get(match.matchId)?.record.currentAction).toBe(1);
  });

  it('no modifica nombres desde consultas y mantiene idempotentes la rendición y la salida', async () => {
    const repository = new MemoryOnlineRepository();
    const service = new OnlineService(repository, () => 1000);
    await service.request(a, { kind: 'search', name: 'a' });
    const stray = { kind: 'state' as const, name: 'nombre inyectado' };
    await service.request(a, stray);
    expect(repository.players.get(a)?.name).toBe('a');
    const match = playing(await service.request(b, { kind: 'search', name: 'b' }));
    const ended = playing(await service.request(a, { kind: 'resign', matchId: match.matchId }));
    const repeated = playing(await service.request(a, { kind: 'resign', matchId: match.matchId }));
    expect(repeated.revision).toBe(ended.revision);
    await service.request(a, { kind: 'finish', matchId: match.matchId });
    expect(await service.request(a, { kind: 'finish', matchId: match.matchId })).toEqual({
      status: 'idle',
    });
    await expect(service.request(a, { kind: 'resign', matchId: match.matchId })).rejects.toThrow(
      'Ya has salido',
    );
    expect(await service.request(a, { kind: 'state' })).toEqual({ status: 'idle' });
  });

  it.each([true, false])('negocia tablas con el rival (aceptar: %s)', async (accept) => {
    const repository = new MemoryOnlineRepository();
    const service = new OnlineService(repository, () => 1000);
    await service.request(a, { kind: 'search', name: 'a' });
    const match = playing(await service.request(b, { kind: 'search', name: 'b' }));
    const offer = playing(
      await service.request(a, { kind: 'offer-draw', matchId: match.matchId, revision: 0 }),
    );
    expect(offer.drawOffer).toBe(offer.player);
    expect(replayRecord(offer.record).outcome).toBeNull();
    const polled = playing(await service.request(b, { kind: 'state' }));
    expect(polled.drawOffer).not.toBe(polled.player);
    await expect(
      service.request(c, {
        kind: 'respond-draw',
        matchId: match.matchId,
        revision: offer.revision,
        accept,
      }),
    ).rejects.toThrow('No perteneces');
    await expect(
      service.request(a, {
        kind: 'respond-draw',
        matchId: match.matchId,
        revision: offer.revision,
        accept,
      }),
    ).rejects.toThrow('No hay una propuesta del rival');
    await expect(
      service.request(b, { kind: 'respond-draw', matchId: match.matchId, revision: 0, accept }),
    ).rejects.toThrow('ha cambiado');
    const ended = playing(
      await service.request(b, {
        kind: 'respond-draw',
        matchId: match.matchId,
        revision: offer.revision,
        accept,
      }),
    );
    expect(ended.drawOffer).toBeNull();
    expect(ended.record.currentAction).toBe(0);
    expect(replayRecord(ended.record).outcome).toEqual(
      accept ? { type: 'draw', reason: 'blockade' } : null,
    );
    expect(repository.players.get(a)?.played).toBe(accept ? 1 : 0);
    await expect(
      service.request(b, {
        kind: 'respond-draw',
        matchId: match.matchId,
        revision: ended.revision,
        accept,
      }),
    ).rejects.toThrow();
  });

  it('retira la propuesta cuando se juega y rechaza aceptaciones antiguas', async () => {
    const repository = new MemoryOnlineRepository();
    const service = new OnlineService(repository, () => 1000);
    await service.request(a, { kind: 'search', name: 'a' });
    const match = playing(await service.request(b, { kind: 'search', name: 'b' }));
    const offer = playing(
      await service.request(a, { kind: 'offer-draw', matchId: match.matchId, revision: 0 }),
    );
    const state = replayRecord(offer.record);
    const active = repository.matches.get(match.matchId)!.players[state.activePlayer];
    const moved = playing(
      await service.request(active, {
        kind: 'action',
        matchId: match.matchId,
        revision: offer.revision,
        action: getAllLegalActions(state)[0],
      }),
    );
    expect(moved.drawOffer).toBeNull();
    await expect(
      service.request(b, {
        kind: 'respond-draw',
        matchId: match.matchId,
        revision: moved.revision,
        accept: true,
      }),
    ).rejects.toThrow('No hay una propuesta');
  });
  it('conserva la espera al reintentar e ignora los filtros antiguos de la cola y del cliente', async () => {
    let now = 0;
    const repository = new MemoryOnlineRepository();
    const service = new OnlineService(repository, () => now);
    await service.request(a, { kind: 'search', name: 'a' });
    const legacyTicket = {
      ...repository.tickets.get(a)!,
      preferences: {
        factions: ['expansionist'],
        fortressHp: [3],
        turnSeconds: [90],
        totalSeconds: [300],
        layouts: [5],
      },
    };
    repository.tickets.set(a, legacyTicket);
    now = 1000;
    await service.request(a, { kind: 'search', name: 'a' });
    expect(repository.tickets.get(a)?.joinedAt).toBe(0);
    // An older client and an older persisted ticket must both use the current public rules.
    repository.tickets.set(a, legacyTicket);
    const legacyRequest = {
      kind: 'search' as const,
      name: 'b',
      preferences: legacyTicket.preferences,
    };
    const match = playing(await service.request(b, legacyRequest));
    expect(match.record.config.options).toMatchObject({ clockSeconds: null, turnClockSeconds: 90 });
    expect(match.record.clock).toMatchObject({ initialMs: null, turnInitialMs: 90_000 });
    expect(
      match.record.initialState.pieces.filter((p) => p.type === 'fortress').map((p) => p.hp),
    ).toEqual([1, 1]);
    expect(match.record.initialState.pieces).toHaveLength(36);
    expect(new Set(match.record.config.participants.map((p) => p.faction)).size).toBe(2);
    expect(repository.tickets.size).toBe(0);
  });
  it('empareja una sola vez ante búsquedas simultáneas y permite recuperar la partida', async () => {
    const repository = new MemoryOnlineRepository();
    const service = new OnlineService(repository, () => 1000);
    const results = await Promise.all(
      [a, b, c].map((id) => service.request(id, { kind: 'search', name: id })),
    );
    expect(repository.matches.size).toBe(1);
    expect(repository.tickets.size).toBe(1);
    const match = playing(results[1]);
    const recovered = playing(await service.request(a, { kind: 'state' }));
    expect(recovered.matchId).toBe(match.matchId);
    expect(recovered.player).not.toBe(match.player);
    expect(replayRecord(recovered.record)).toEqual(replayRecord(match.record));
    expect(recovered.record.config).toEqual(match.record.config);
    expect(recovered.record.config.options.allowUndo).toBe(false);
  });
  it('respeta los ajustes privados, consume el código una sola vez y no cambia Elo', async () => {
    const repository = new MemoryOnlineRepository();
    const service = new OnlineService(repository, () => 1000);
    const room = privateWaiting(
      await service.request(a, { kind: 'create-private', name: 'Anfitrión', settings }),
    );
    expect(room.code).toMatch(/^[0-9]{6}$/);
    const joined = playing(
      await service.request(b, { kind: 'join-private', name: 'Invitado', code: room.code }),
    );
    expect(joined.record.clock).toBeNull();
    expect(joined.record.config.participants[0].faction).toBe('conservationist');
    expect(
      joined.record.initialState.pieces.filter((p) => p.type === 'fortress').map((p) => p.hp),
    ).toEqual([3, 3]);
    expect(joined.record.initialState.pieces).toHaveLength(44);
    await expect(
      service.request(c, { kind: 'join-private', name: 'Tercero', code: room.code }),
    ).rejects.toThrow('No existe una sala');
    await service.request(a, { kind: 'resign', matchId: joined.matchId });
    expect(repository.players.get(a)?.elo).toBe(1000);
    expect(repository.players.get(b)?.elo).toBe(1000);
    expect(repository.players.get(a)?.played).toBe(0);
    expect(repository.players.get(b)?.played).toBe(0);
  });
  it('rechaza jugadas del rival, ilegales, repetidas y ajenas a la partida', async () => {
    const repository = new MemoryOnlineRepository();
    const service = new OnlineService(repository, () => 1000);
    await service.request(a, {
      kind: 'search',
      name: 'a',
    });
    const matched = playing(
      await service.request(b, {
        kind: 'search',
        name: 'b',
      }),
    );
    const state = replayRecord(matched.record);
    const activeId = [...repository.matches.values()][0].players[state.activePlayer];
    const otherId = activeId === a ? b : a;
    const action = getAllLegalActions(state)[0];
    const request = { kind: 'action' as const, matchId: matched.matchId, revision: 0, action };
    await expect(service.request(otherId, request)).rejects.toThrow('turno del rival');
    await expect(service.request(c, request)).rejects.toThrow('No perteneces');
    await expect(
      service.request(activeId, {
        ...request,
        action: { kind: 'shoot', pieceId: 'missing', targetId: 'missing' },
      }),
    ).rejects.toThrow('no es legal');
    const result = playing(await service.request(activeId, request));
    expect(result.record.currentAction).toBe(1);
    expect(result.revision).toBe(1);
    await expect(service.request(activeId, request)).rejects.toThrow('ha cambiado');
  });
  it('liquida Elo una vez, no permite abandonar una partida activa sin rendirse y permite salir al acabar', async () => {
    const repository = new MemoryOnlineRepository();
    const service = new OnlineService(repository, () => 1000);
    await service.request(a, {
      kind: 'search',
      name: 'a',
    });
    const match = playing(
      await service.request(b, {
        kind: 'search',
        name: 'b',
      }),
    );
    expect((await service.request(a, { kind: 'cancel' })).status).toBe('playing');
    await expect(service.request(a, { kind: 'finish', matchId: match.matchId })).rejects.toThrow(
      'sigue en curso',
    );
    const ended = playing(await service.request(a, { kind: 'resign', matchId: match.matchId }));
    expect(replayRecord(ended.record).outcome?.reason).toBe('resignation');
    const elo = repository.players.get(a)?.elo;
    expect(elo).toBeLessThan(1000);
    await service.request(a, { kind: 'resign', matchId: match.matchId });
    expect(repository.players.get(a)?.elo).toBe(elo);
    expect(repository.players.get(a)?.played).toBe(1);
    expect(await service.request(a, { kind: 'finish', matchId: match.matchId })).toEqual({
      status: 'idle',
    });
    expect(await service.request(a, { kind: 'state' })).toEqual({ status: 'idle' });
  });
  it('expira salas y búsquedas abandonadas, y permite cancelarlas', async () => {
    let now = 0;
    const repository = new MemoryOnlineRepository();
    const service = new OnlineService(repository, () => now);
    await service.request(a, {
      kind: 'search',
      name: 'a',
    });
    now = 46000;
    expect(
      (
        await service.request(b, {
          kind: 'search',
          name: 'b',
        })
      ).status,
    ).toBe('searching');
    expect(repository.tickets.has(a)).toBe(false);
    await service.request(b, { kind: 'cancel' });
    const room = privateWaiting(
      await service.request(a, { kind: 'create-private', name: 'a', settings }),
    );
    now = room.expiresAt;
    await expect(
      service.request(b, { kind: 'join-private', name: 'b', code: room.code }),
    ).rejects.toThrow('caducado');
    await service.request(a, { kind: 'cancel' });
    expect(repository.privateRooms.size).toBe(0);
  });
  // These integration tests execute several real AI turns; coverage instruments the search too.
  it('el servidor juega al caducar el turno aunque ambos clientes estén desconectados', async () => {
    let now = 0;
    const repository = new MemoryOnlineRepository();
    const service = new OnlineService(repository, () => now);
    await service.request(a, {
      kind: 'search',
      name: 'a',
    });
    const match = playing(
      await service.request(b, {
        kind: 'search',
        name: 'b',
      }),
    );
    now = 89_999;
    await service.tick();
    expect(repository.matches.get(match.matchId)?.record.currentAction).toBe(0);
    now = 90_001;
    await service.tick();
    const advanced = playing(await service.request(a, { kind: 'state' }));
    expect(advanced.record.currentAction).toBe(1);
    expect(advanced.record.clock?.turnTimeouts?.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(advanced.matchId).toBe(match.matchId);
    now = 900_001;
    await service.tick();
    const ended = playing(await service.request(a, { kind: 'state' }));
    expect(ended.record.currentAction).toBeGreaterThanOrEqual(1);
    expect(replayRecord(ended.record).outcome?.reason).toBe('timeout');
    expect(ended.record.clock?.turnTimeouts).toContain(3);
  }, 15_000);
  it('recupera los vencimientos tras un arranque en frío sin intervalos ni tiempo extra', async () => {
    let now = 0;
    const repository = new MemoryOnlineRepository();
    const service = new OnlineService(repository, () => now);
    await service.request(a, { kind: 'search', name: 'a' });
    const match = playing(await service.request(b, { kind: 'search', name: 'b' }));
    now = 90_001;
    const resumed = playing(
      await new OnlineService(repository, () => now).request(a, { kind: 'state' }),
    );
    expect(resumed.matchId).toBe(match.matchId);
    expect(resumed.record.currentAction).toBe(1);
    expect(resumed.record.clock?.turnRemainingMs).toBe(89_999);
    now = 900_001;
    const ended = playing(
      await new OnlineService(repository, () => now).request(b, { kind: 'state' }),
    );
    expect(replayRecord(ended.record).outcome?.reason).toBe('timeout');
    expect(ended.record.clock?.turnTimeouts).toContain(3);
    const elo = repository.players.get(a)?.elo;
    await new OnlineService(repository, () => now).request(a, { kind: 'state' });
    expect(repository.players.get(a)?.elo).toBe(elo);
    expect(repository.players.get(a)?.played).toBe(1);
  }, 15_000);
  it('protege HTTP por token y origen, y valida cuerpos', async () => {
    const service = new OnlineService(new MemoryOnlineRepository());
    const app = await createOnlineApp({
      service,
      origin: 'http://localhost:5173',
      authenticate: async (token) => (token === 'valid' ? { id: a, isAnonymous: false } : null),
    });
    try {
      const call = (payload: Record<string, unknown>, headers = {}) =>
        app.inject({ method: 'POST', url: '/api/online', payload, headers });
      expect((await call({ kind: 'state' })).statusCode).toBe(401);
      expect((await call({ kind: 'state' }, { authorization: 'Bearer invalid' })).statusCode).toBe(
        401,
      );
      expect(
        (
          await call(
            { kind: 'state' },
            { authorization: 'Bearer valid', origin: 'https://other.example' },
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (await call({ kind: 'unexpected' }, { authorization: 'Bearer valid' })).statusCode,
      ).toBe(400);
      expect(
        (await call({ kind: 'search', name: '' }, { authorization: 'Bearer valid' })).statusCode,
      ).toBe(400);
      expect((await call({ kind: 'state' }, { authorization: 'Bearer valid' })).json()).toEqual({
        status: 'idle',
      });
      for (const payload of [
        { kind: 'resign' },
        { kind: 'finish', matchId: '-'.repeat(36) },
        { kind: 'action', matchId: a, revision: -1 },
        { kind: 'offer-draw', matchId: a, revision: '0' },
        { kind: 'respond-draw', matchId: a, revision: 0, accept: 'true' },
        { kind: 'create-private', name: 'a', settings: {} },
        { kind: 'join-private', name: 'a', code: 123456 },
      ]) {
        const response = await call(payload, { authorization: 'Bearer valid' });
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
        expect(response.headers['cache-control']).toBe('no-store');
      }
    } finally {
      await app.close();
    }
  });

  it('limita por identidad verificada sin bloquear a otro jugador que comparte la IP', async () => {
    const service = new OnlineService(new MemoryOnlineRepository());
    const app = await createOnlineApp({
      service,
      origin: 'http://localhost:5173',
      authenticate: async (token) => ({ id: token === 'a' ? a : b, isAnonymous: false }),
    });
    try {
      const call = (token: string) =>
        app.inject({
          method: 'POST',
          url: '/api/online',
          payload: { kind: 'state' },
          headers: { authorization: `Bearer ${token}` },
        });
      for (let i = 0; i < 300; i++) expect((await call('a')).statusCode).toBe(200);
      const exceeded = await call('a');
      expect(exceeded.statusCode).toBe(429);
      expect(Number(exceeded.headers['retry-after'])).toBeGreaterThan(0);
      expect((await call('b')).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
