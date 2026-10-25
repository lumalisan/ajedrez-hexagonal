import { randomInt, randomUUID } from 'node:crypto';
import { sameAction } from '../src/action-identity.js';
import { chooseMachineAction } from '../src/ai.js';
import { createGameState, getAllLegalActions, declareBlockade } from '../src/engine.js';
import { createClassicConfig } from '../src/game-config.js';
import { MatchController } from '../src/match-controller.js';
import { createMatchRecord, replayRecord } from '../src/match-record.js';
import { activeClockRemainingMs } from '../src/match-clock.js';
import { calculateElo } from '../src/progression.js';
import { matchSearchTickets, validPrivateCode } from '../src/online-matchmaking.js';
import type { MatchedSettings } from '../src/online-matchmaking.js';
import type { OnlineRequest, OnlineState, PrivateMatchSettings } from '../src/online-contracts.js';
import type { GameAction } from '../src/types.js';
import type {
  OnlineMatch,
  OnlinePlayer,
  OnlineRepository,
  OnlineTransaction,
} from './repository.js';

export class OnlineError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export function validPrivateSettings(value: unknown): value is PrivateMatchSettings {
  if (!value || typeof value !== 'object') return false;
  const s = value as PrivateMatchSettings;
  return (
    ['expansionist', 'conservationist'].includes(s.faction) &&
    [1, 2, 3].includes(s.fortressHp) &&
    ['', 30, 60, 90].includes(s.turnSeconds) &&
    ['', 300, 600, 1200].includes(s.totalSeconds) &&
    [3, 5].includes(s.layout)
  );
}

/** Authentication is performed at the HTTP boundary. User IDs and Elo never come from requests. */
export class OnlineService {
  constructor(
    private readonly repository: OnlineRepository,
    private readonly now = Date.now,
  ) {}

  async request(
    playerId: string,
    request: OnlineRequest,
    publicAllowed = true,
  ): Promise<OnlineState> {
    if (!publicAllowed && request.kind === 'search')
      throw new OnlineError('Inicia sesión con una cuenta para buscar partida.', 403);
    if (
      request.kind === 'action' ||
      request.kind === 'resign' ||
      request.kind === 'finish' ||
      request.kind === 'offer-draw' ||
      request.kind === 'respond-draw'
    ) {
      if (typeof request.matchId !== 'string' || !/^[0-9a-f-]{36}$/i.test(request.matchId))
        throw new OnlineError('Partida no válida.');
      return this.repository.transaction(`match:${request.matchId}`, async (tx) => {
        const match = await tx.match(request.matchId);
        if (!match || !match.players.includes(playerId))
          throw new OnlineError('No perteneces a esta partida.', 403);
        await this.advance(tx, match);
        const controller = new MatchController(match.record);
        const state = controller.store.getState().game;
        const player = match.players.indexOf(playerId) as 0 | 1;
        if (request.kind === 'finish') {
          if (!state.outcome) throw new OnlineError('La partida sigue en curso.', 409);
          if (!match.finishedBy.includes(playerId)) match.finishedBy.push(playerId);
          await tx.saveMatch(match);
          return { status: 'idle' };
        }
        if (request.kind === 'offer-draw' || request.kind === 'respond-draw') {
          if (state.outcome || request.revision !== match.revision)
            throw new OnlineError('La partida ha cambiado. Actualiza la posición.', 409);
          if (request.kind === 'offer-draw') {
            if (match.drawOffer != null)
              throw new OnlineError('Ya hay una propuesta pendiente.', 409);
            match.drawOffer = player;
          } else {
            if (typeof request.accept !== 'boolean') throw new OnlineError('Respuesta no válida.');
            if (match.drawOffer == null || match.drawOffer === player)
              throw new OnlineError('No hay una propuesta del rival.', 409);
            if (request.accept) {
              const result = declareBlockade(state);
              if (!result.ok || !result.state.outcome)
                throw new OnlineError('No se pueden acordar tablas.');
              controller.pauseClock(this.now());
              controller.conclude(result.state.outcome);
            }
            match.drawOffer = null;
          }
        } else if (!state.outcome && request.kind === 'resign') {
          controller.resign(player);
        } else if (request.kind === 'action') {
          if (state.outcome || request.revision !== match.revision)
            throw new OnlineError('La partida ha cambiado. Actualiza la posición.', 409);
          if (player !== state.activePlayer) throw new OnlineError('Es el turno del rival.', 409);
          match.drawOffer = null;
          const action = canonicalAction(getAllLegalActions(state), request.action);
          if (!action || !controller.commit(action).ok)
            throw new OnlineError('La orden no es legal.');
          if (controller.store.getState().game.outcome) controller.pauseClock(this.now());
          else {
            controller.switchClock(controller.store.getState().game.activePlayer, this.now(), true);
            controller.resumeClock(this.now());
          }
        }
        match.record = controller.record;
        match.revision++;
        await this.settle(tx, match);
        await tx.saveMatch(match);
        return this.matchState(tx, match, playerId);
      });
    }

    // Only queue/room allocation is serialized globally; independent matches have their own lock.
    const lobby = await this.repository.transaction(
      'online:lobby',
      async (tx): Promise<OnlineState | { matchId: string }> => {
        const now = this.now();
        let player = await tx.player(playerId);
        if (!player) {
          player = { id: playerId, name: 'Jugador', elo: 1000, played: 0 };
          await tx.savePlayer(player);
        }
        if ('name' in request) {
          if (
            typeof request.name !== 'string' ||
            !request.name.trim() ||
            request.name.trim().length > 40
          )
            throw new OnlineError('El nombre debe tener entre 1 y 40 caracteres.');
          player.name = request.name.trim();
          await tx.savePlayer(player);
        }
        const active = await tx.activeMatch(playerId);
        if (active) return { matchId: active.id };
        for (const ticket of await tx.queue())
          if (ticket.seenAt < now - 45_000) await tx.removeTicket(ticket.playerId);
        for (const room of await tx.rooms())
          if (room.expiresAt <= now) await tx.removeRoom(room.code);
        if (request.kind === 'cancel') {
          await this.clearWaiting(tx, playerId);
          return { status: 'idle' };
        }
        const waitingRoom = (await tx.rooms()).find((room) => room.creatorId === playerId);
        if (waitingRoom)
          return {
            status: 'private-waiting',
            code: waitingRoom.code,
            expiresAt: waitingRoom.expiresAt,
          };
        if (request.kind === 'create-private') {
          if (!validPrivateSettings(request.settings))
            throw new OnlineError('Configuración privada no válida.');
          await this.clearWaiting(tx, playerId);
          for (let attempt = 0; attempt < 20; attempt++) {
            const room = {
              code: String(randomInt(100_000, 1_000_000)),
              creatorId: playerId,
              settings: request.settings,
              expiresAt: now + 600_000,
            };
            if (await tx.saveRoom(room))
              return { status: 'private-waiting', code: room.code, expiresAt: room.expiresAt };
          }
          throw new OnlineError('No se ha podido reservar un código. Inténtalo de nuevo.', 503);
        }
        if (request.kind === 'join-private') {
          if (typeof request.code !== 'string' || !validPrivateCode(request.code))
            throw new OnlineError('Introduce un código de seis cifras.');
          const room = (await tx.rooms()).find((entry) => entry.code === request.code);
          if (!room)
            throw new OnlineError(
              'No existe una sala disponible con ese código o ha caducado.',
              404,
            );
          const creator = await tx.player(room.creatorId);
          if (!creator || (await tx.activeMatch(creator.id)))
            throw new OnlineError('La sala ya no está disponible.', 409);
          const settings = room.settings;
          const match = this.createMatch(
            [creator, player],
            {
              factions: [
                settings.faction,
                settings.faction === 'expansionist' ? 'conservationist' : 'expansionist',
              ],
              fortressHp: settings.fortressHp,
              turnSeconds: settings.turnSeconds,
              totalSeconds: settings.totalSeconds,
              layout: settings.layout,
            },
            false,
          );
          await tx.saveMatch(match);
          await this.clearWaiting(tx, creator.id);
          await this.clearWaiting(tx, playerId);
          return { matchId: match.id };
        }
        if (!publicAllowed) {
          await tx.removeTicket(playerId);
          return { status: 'idle' };
        }
        let ticket = (await tx.queue()).find((entry) => entry.playerId === playerId);
        if (request.kind === 'search') {
          ticket = {
            playerId,
            elo: player.elo,
            joinedAt: ticket?.joinedAt ?? now,
            seenAt: now,
          };
        }
        if (!ticket) return { status: 'idle' };
        ticket.seenAt = now;
        await tx.saveTicket(ticket);
        for (const other of await tx.queue()) {
          const settings = matchSearchTickets(
            ticket,
            other,
            now,
            () => randomInt(0, 0x1000000) / 0x1000000,
          );
          if (!settings) continue;
          if (await tx.activeMatch(other.playerId)) {
            await tx.removeTicket(other.playerId);
            continue;
          }
          const opponent = await tx.player(other.playerId);
          if (!opponent) continue;
          const match = this.createMatch([player, opponent], settings, true);
          await tx.saveMatch(match);
          await this.clearWaiting(tx, playerId);
          await this.clearWaiting(tx, opponent.id);
          return { matchId: match.id };
        }
        return { status: 'searching', joinedAt: ticket.joinedAt, elo: player.elo };
      },
    );
    if (!('matchId' in lobby)) return lobby;
    return this.repository.transaction(`match:${lobby.matchId}`, async (tx) => {
      const match = await tx.match(lobby.matchId);
      if (!match || !match.players.includes(playerId))
        throw new OnlineError('Partida no disponible.', 404);
      await this.advance(tx, match);
      return this.matchState(tx, match, playerId);
    });
  }

  /** A server-owned sweep keeps clocks moving even if both browsers disconnect. */
  async tick(): Promise<void> {
    for (const id of await this.repository.activeMatches()) {
      await this.repository.transaction(`match:${id}`, async (tx) => {
        const match = await tx.match(id);
        if (match) await this.advance(tx, match);
      });
    }
  }

  private createMatch(
    players: [OnlinePlayer, OnlinePlayer],
    settings: Omit<MatchedSettings, 'turnSeconds'> & {
      turnSeconds: PrivateMatchSettings['turnSeconds'];
    },
    ranked: boolean,
  ): OnlineMatch {
    const config = createClassicConfig({
      mode: 'local',
      playerNames: [players[0].name, players[1].name],
      faction: settings.factions[0],
      fortressHp: settings.fortressHp,
      initialLayout: settings.layout,
      clockSeconds: settings.totalSeconds || null,
      turnClockSeconds: settings.turnSeconds || null,
      fixedBoard: true,
      handoffScreen: false,
    });
    const id = randomUUID();
    config.definitionId = `online:${ranked ? 'ranked' : 'private'}:${id}`;
    config.options.allowUndo = false;
    const controller = new MatchController(
      createMatchRecord(
        config,
        createGameState(
          config.setup.map(({ piece }) => piece),
          randomInt(0, 2) as 0 | 1,
        ),
      ),
    );
    controller.resumeClock(this.now());
    return {
      id,
      players: [players[0].id, players[1].id],
      record: controller.record,
      revision: 0,
      ranked,
      settled: false,
      finishedBy: [],
    };
  }

  private async advance(tx: OnlineTransaction, match: OnlineMatch): Promise<void> {
    if (match.settled) return;
    const controller = new MatchController(match.record);
    const now = this.now();
    // Charge missed deadlines after downtime, rather than granting fresh time on reconnect.
    while (!controller.store.getState().game.outcome) {
      const before = controller.record.clock;
      const deadline =
        before?.lastTickAt != null ? before.lastTickAt + activeClockRemainingMs(before) : now;
      controller.tickClock(now);
      if (controller.record.clock?.status !== 'turn-expired') break;
      const action = chooseMachineAction(controller.store.getState().game);
      if (action) {
        controller.commit(action);
        if (controller.store.getState().game.outcome) controller.pauseClock(deadline);
        else {
          controller.switchClock(controller.store.getState().game.activePlayer, deadline, true);
          controller.resumeClock(deadline);
        }
        match.drawOffer = null;
        match.revision++;
      } else break;
    }
    const state = controller.store.getState().game;
    if (state.outcome && !replayRecord(match.record).outcome) match.revision++;
    match.record = controller.record;
    await this.settle(tx, match);
    await tx.saveMatch(match);
  }

  private async settle(tx: OnlineTransaction, match: OnlineMatch): Promise<void> {
    const outcome = replayRecord(match.record).outcome;
    if (!outcome || match.settled) return;
    match.settled = true;
    match.drawOffer = null;
    if (!match.ranked) return;
    // Stable row order prevents deadlocks when several matches finish together.
    const players = new Map<string, OnlinePlayer>();
    for (const id of [...match.players].sort()) {
      const player = await tx.player(id);
      if (player) players.set(id, player);
    }
    const first = players.get(match.players[0]);
    const second = players.get(match.players[1]);
    if (!first || !second) throw new Error('Faltan participantes de una partida.');
    const score = outcome.type === 'draw' ? 0.5 : outcome.winner === 0 ? 1 : 0;
    match.rankingResult = {
      completedAt: new Date(this.now()).toISOString(),
      score,
      ratingsBefore: [first.elo, second.elo],
    };
    const a = calculateElo(first.elo, second.elo, score, first.played);
    const b = calculateElo(second.elo, first.elo, 1 - score, second.played);
    await tx.savePlayer({ ...first, elo: a, played: first.played + 1 });
    await tx.savePlayer({ ...second, elo: b, played: second.played + 1 });
  }

  private async matchState(
    tx: OnlineTransaction,
    match: OnlineMatch,
    id: string,
  ): Promise<OnlineState> {
    return {
      status: 'playing',
      matchId: match.id,
      player: match.players.indexOf(id) as 0 | 1,
      revision: match.revision,
      record: match.record,
      elo: (await tx.player(id))?.elo ?? 1000,
      serverNow: this.now(),
      drawOffer: match.drawOffer ?? null,
    };
  }

  private async clearWaiting(tx: OnlineTransaction, id: string): Promise<void> {
    await tx.removeTicket(id);
    for (const room of await tx.rooms()) if (room.creatorId === id) await tx.removeRoom(room.code);
  }
}

function canonicalAction(legal: GameAction[], value: unknown): GameAction | null {
  if (!value || typeof value !== 'object') return null;
  try {
    return legal.find((action) => sameAction(action, value as GameAction)) ?? null;
  } catch {
    return null;
  }
}
