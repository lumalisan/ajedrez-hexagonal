import type { Faction, MatchClockValue } from './match-options.js';
import type { FortressHp } from './types.js';

export interface SearchTicket {
  playerId: string;
  elo: number;
  joinedAt: number;
}

export interface MatchedSettings {
  factions: [Faction, Faction];
  fortressHp: FortressHp;
  turnSeconds: 30 | 60 | 90;
  totalSeconds: MatchClockValue;
  layout: 3 | 5;
}

/** Widen by 50 points every 15 seconds, reaching the hard cap after one minute. */
export function eloSearchRange(waitMs: number): number {
  return 200 + Math.min(4, Math.floor(Math.max(0, waitMs) / 15_000)) * 50;
}

/** Standard rules for every new public match, owned by the server. */
export const PUBLIC_MATCH_SETTINGS = Object.freeze({
  fortressHp: 1,
  turnSeconds: 30,
  totalSeconds: '',
  layout: 3,
} as const);

/** No randomness is consumed until both Elo windows are compatible. */
export function matchSearchTickets(
  first: SearchTicket,
  second: SearchTicket,
  now: number,
  random: () => number,
): MatchedSettings | null {
  if (
    first.playerId === second.playerId ||
    ![first, second].every(
      (ticket) =>
        ticket.playerId.trim() &&
        Number.isFinite(ticket.elo) &&
        ticket.elo >= 0 &&
        Number.isFinite(ticket.joinedAt) &&
        ticket.joinedAt <= now,
    ) ||
    !Number.isFinite(now)
  )
    return null;
  const difference = Math.abs(first.elo - second.elo);
  if (
    difference > eloSearchRange(now - first.joinedAt) ||
    difference > eloSearchRange(now - second.joinedAt)
  )
    return null;
  const roll = random();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1)
    throw new Error('El sorteo necesita un valor entre 0 (incluido) y 1 (excluido).');
  return {
    ...PUBLIC_MATCH_SETTINGS,
    factions:
      roll < 0.5 ? ['expansionist', 'conservationist'] : ['conservationist', 'expansionist'],
  };
}

export function validPrivateCode(code: string): boolean {
  return /^[0-9]{6}$/.test(code);
}
