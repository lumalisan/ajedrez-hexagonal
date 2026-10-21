import type { Faction, MatchClockValue, TurnClockValue } from './match-options.js';
import type { FortressHp, GameAction, MatchRecord, Player } from './types.js';

export interface PrivateMatchSettings {
  faction: Faction;
  fortressHp: FortressHp;
  turnSeconds: TurnClockValue;
  totalSeconds: MatchClockValue;
  layout: 3 | 5;
}

export type OnlineState =
  | { status: 'idle' }
  | { status: 'searching'; joinedAt: number; elo: number }
  | { status: 'private-waiting'; code: string; expiresAt: number }
  | {
      status: 'playing';
      matchId: string;
      player: Player;
      revision: number;
      record: MatchRecord;
      elo: number;
      serverNow: number;
    };

export type OnlineRequest =
  | { kind: 'state' }
  | { kind: 'search'; name: string }
  | { kind: 'create-private'; settings: PrivateMatchSettings; name: string }
  | { kind: 'join-private'; code: string; name: string }
  | { kind: 'cancel' }
  | { kind: 'action'; matchId: string; revision: number; action: GameAction }
  | { kind: 'resign'; matchId: string }
  | { kind: 'finish'; matchId: string };

export interface OnlineClient {
  dispose?(): void;
  request(request: OnlineRequest, signal: AbortSignal): Promise<OnlineState>;
}
