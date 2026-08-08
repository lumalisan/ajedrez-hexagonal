import { actionKey } from './action-identity';
import { applyAction, getAllLegalActions, getPiece, otherPlayerOf } from './engine';
import { hexKey } from './hex';
import type { GameAction, GameState, Hex, Player } from './types';

export type ThreatConsequence = 'destruction' | 'conversion' | 'fortress-damage';

export interface ImmediateThreat {
  attackerId: string;
  targetId: string;
  at: Hex;
  action: GameAction;
  consequence: ThreatConsequence;
}

export interface TacticalAnalysis {
  defender: Player;
  threats: ImmediateThreat[];
  threatenedCells: Hex[];
  threatenedPieceIds: string[];
}

const cache = new WeakMap<GameState, Map<Player, TacticalAnalysis>>();

/**
 * Calculates only immediate, legal hostile consequences. It deliberately does not
 * guess future AI intent, so the overlay always represents information the player
 * can verify from the current position.
 */
export function analyzeImmediateThreats(
  state: GameState,
  defender: Player = state.activePlayer,
): TacticalAnalysis {
  const cached = cache.get(state)?.get(defender);
  if (cached) return cached;

  const attacker = otherPlayerOf(defender);
  const analysisState: GameState = { ...state, activePlayer: attacker };
  const threats: ImmediateThreat[] = [];
  const seen = new Set<string>();

  for (const action of getAllLegalActions(analysisState)) {
    const result = applyAction(analysisState, action);
    if (!result.ok) continue;
    for (const event of result.events) {
      if (
        !event.targetId ||
        !event.at ||
        !['destroy', 'convert', 'fortressDamage'].includes(event.type)
      )
        continue;
      const target = getPiece(analysisState, event.targetId);
      if (!target || target.owner !== defender) continue;
      const key = `${actionKey(action)}:${event.type}:${event.targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      threats.push({
        attackerId: action.pieceId,
        targetId: event.targetId,
        at: { ...event.at },
        action,
        consequence:
          event.type === 'convert'
            ? 'conversion'
            : event.type === 'fortressDamage'
              ? 'fortress-damage'
              : 'destruction',
      });
    }
  }

  const cells = new Map<string, Hex>();
  const pieces = new Set<string>();
  for (const threat of threats) {
    cells.set(hexKey(threat.at), threat.at);
    pieces.add(threat.targetId);
  }
  const analysis: TacticalAnalysis = {
    defender,
    threats,
    threatenedCells: [...cells.values()],
    threatenedPieceIds: [...pieces],
  };
  const stateCache = cache.get(state) ?? new Map<Player, TacticalAnalysis>();
  stateCache.set(defender, analysis);
  cache.set(state, stateCache);
  return analysis;
}
