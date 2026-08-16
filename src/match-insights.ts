import { actionKey } from './action-identity';
import {
  applyAction,
  cloneState,
  describeAction,
  getAllLegalActions,
  getPiece,
  PIECE_NAMES,
  type ActionResolutionRules,
} from './engine';
import { resolutionRulesForConfig } from './match-record';
import type { GameAction, GameEvent, GameState, MatchRecord, PieceType, Player } from './types';

const PIECE_VALUE: Record<PieceType, number> = {
  soldier: 1,
  capturer: 3,
  medium: 4,
  long: 4,
  fast: 5,
  drone: 4,
  airplane: 5,
  antiAir: 3,
  fortress: 12,
};

export interface MatchInsight {
  actionIndex: number;
  player: Player;
  title: string;
  detail: string;
  impact: number;
  action: GameAction;
  suggestedAlternative?: GameAction;
  suggestedAlternativeLabel?: string;
}

export function analyzeMatchMoments(record: MatchRecord, limit = 3): MatchInsight[] {
  let state = cloneState(record.initialState);
  const moments: MatchInsight[] = [];
  const rules = resolutionRulesForConfig(record.config);

  for (let index = 0; index < record.currentAction; index += 1) {
    const action = record.actions[index];
    const player = state.activePlayer;
    const actionLabel = describeAction(state, action);
    const alternative = bestImmediateAlternative(state, action, rules);
    const result = applyAction(state, action, rules);
    if (!result.ok) break;
    const impact = eventImpact(state, result.state, result.events, player);
    const narrative = insightNarrative(result.events, state, actionLabel, impact);
    if (narrative || Math.abs(impact) >= 2) {
      moments.push({
        actionIndex: index + 1,
        player,
        title: narrative?.title ?? 'Cambio de iniciativa',
        detail: narrative?.detail ?? `${actionLabel} cambió el equilibrio material.`,
        impact,
        action,
        suggestedAlternative: alternative,
        suggestedAlternativeLabel: alternative ? describeAction(state, alternative) : undefined,
      });
    }
    state = result.state;
  }

  return moments
    .sort(
      (left, right) =>
        Math.abs(right.impact) - Math.abs(left.impact) || left.actionIndex - right.actionIndex,
    )
    .slice(0, Math.max(1, limit))
    .sort((left, right) => left.actionIndex - right.actionIndex);
}

export function replayStateAt(record: MatchRecord, actionIndex: number): GameState {
  let state = cloneState(record.initialState);
  const end = Math.max(0, Math.min(actionIndex, record.currentAction));
  const rules = resolutionRulesForConfig(record.config);
  for (let index = 0; index < end; index += 1) {
    const result = applyAction(state, record.actions[index], rules);
    if (!result.ok) break;
    state = result.state;
  }
  return state;
}

function bestImmediateAlternative(
  state: GameState,
  played: GameAction,
  rules: Readonly<ActionResolutionRules>,
): GameAction | undefined {
  const playedKey = actionKey(played);
  const player = state.activePlayer;
  return getAllLegalActions(state)
    .filter((candidate) => actionKey(candidate) !== playedKey)
    .map((candidate) => ({
      candidate,
      score: immediateActionScore(state, candidate, player, rules),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        actionKey(left.candidate).localeCompare(actionKey(right.candidate)),
    )[0]?.candidate;
}

function immediateActionScore(
  state: GameState,
  action: GameAction,
  player: Player,
  rules: Readonly<ActionResolutionRules>,
): number {
  const result = applyAction(state, action, rules);
  if (!result.ok) return Number.NEGATIVE_INFINITY;
  if (result.state.outcome?.type === 'win' && result.state.outcome.winner === player) return 10_000;
  return eventImpact(state, result.state, result.events, player);
}

function eventImpact(
  before: GameState,
  after: GameState,
  events: GameEvent[],
  player: Player,
): number {
  const afterIds = new Set(after.pieces.map((piece) => piece.id));
  let score = 0;
  for (const piece of before.pieces) {
    if (afterIds.has(piece.id)) continue;
    score += (piece.owner === player ? -1 : 1) * PIECE_VALUE[piece.type];
  }
  for (const piece of after.pieces) {
    const old = getPiece(before, piece.id);
    if (old && old.owner !== piece.owner) score += piece.owner === player ? 3 : -3;
  }
  score += events
    .filter((event) => event.type === 'fortressDamage')
    .reduce((total, event) => total + (event.owner === player ? 8 : -8) * (event.amount ?? 1), 0);
  return score;
}

function insightNarrative(
  events: GameEvent[],
  before: GameState,
  actionLabel: string,
  impact: number,
): { title: string; detail: string } | undefined {
  if (events.some((event) => event.type === 'victory')) {
    return { title: 'Orden decisiva', detail: `${actionLabel} cerró la batalla.` };
  }
  if (events.some((event) => event.type === 'fortressDamage')) {
    return {
      title: 'Brecha en la Fortaleza',
      detail: `${actionLabel} cambió la presión estratégica.`,
    };
  }
  const converted = events.find((event) => event.type === 'convert' && event.targetId);
  if (converted?.targetId) {
    const piece = getPiece(before, converted.targetId);
    return {
      title: 'Cambio de lealtad',
      detail: `${actionLabel}${piece ? ` convirtió un ${PIECE_NAMES[piece.type]}` : ''}.`,
    };
  }
  const destroyed = events.find(
    (event) => event.type === 'destroy' && event.targetId && event.targetId !== event.pieceId,
  );
  if (destroyed?.targetId) {
    const piece = getPiece(before, destroyed.targetId);
    return {
      title: 'Cambio de iniciativa',
      detail: `${actionLabel}${piece ? ` neutralizó un ${PIECE_NAMES[piece.type]}` : ''}.`,
    };
  }
  if (Math.abs(impact) >= 4) {
    return {
      title: impact > 0 ? 'Ventaja material' : 'Sacrificio costoso',
      detail: `${actionLabel} produjo uno de los mayores cambios de material.`,
    };
  }
  return undefined;
}
