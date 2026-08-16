import {
  applyAction,
  DEFAULT_ACTION_RESOLUTION_RULES,
  describeAction,
  getPiece,
  PIECE_NAMES,
  PLAYER_NAMES,
  type ActionResolutionRules,
} from './engine';
import { analyzeImmediateThreats } from './tactical-analysis';
import type { GameAction, GameState, Piece } from './types';

export interface ActionConsequences {
  ok: boolean;
  actionLabel: string;
  summaries: string[];
  captured: Piece[];
  lost: Piece[];
  converted: Piece[];
  fortressDamage: number;
  newlyThreatened: Piece[];
  outcomeLabel?: string;
  error?: string;
}

/**
 * Explains only deterministic, immediately verifiable consequences. It never
 * guesses which reply an opponent or the AI intends to play.
 */
export function analyzeActionConsequences(
  state: GameState,
  action: GameAction,
  rules: Readonly<ActionResolutionRules> = DEFAULT_ACTION_RESOLUTION_RULES,
): ActionConsequences {
  const actor = getPiece(state, action.pieceId);
  const owner = actor?.owner ?? state.activePlayer;
  const result = applyAction(state, action, rules);
  const actionLabel = describeAction(state, action);
  if (!result.ok) {
    return {
      ok: false,
      actionLabel,
      summaries: [],
      captured: [],
      lost: [],
      converted: [],
      fortressDamage: 0,
      newlyThreatened: [],
      error: result.error ?? 'La orden ya no es legal.',
    };
  }

  const beforeById = new Map(state.pieces.map((piece) => [piece.id, piece]));
  const afterById = new Map(result.state.pieces.map((piece) => [piece.id, piece]));
  const removed = state.pieces.filter((piece) => !afterById.has(piece.id));
  const captured = removed.filter((piece) => piece.owner !== owner && piece.type !== 'fortress');
  const lost = removed.filter((piece) => piece.owner === owner && piece.type !== 'fortress');
  const converted = result.state.pieces.filter((piece) => {
    const before = beforeById.get(piece.id);
    return before && before.owner !== piece.owner && piece.owner === owner;
  });
  const fortressDamage = result.events
    .filter((event) => event.type === 'fortressDamage' && event.owner === owner)
    .reduce((total, event) => total + (event.amount ?? 1), 0);

  const beforeThreats = new Set(analyzeImmediateThreats(state, owner).threatenedPieceIds);
  const afterThreats = new Set(analyzeImmediateThreats(result.state, owner).threatenedPieceIds);
  const newlyThreatened = result.state.pieces.filter(
    (piece) => piece.owner === owner && afterThreats.has(piece.id) && !beforeThreats.has(piece.id),
  );

  const summaries: string[] = [];
  if (captured.length) summaries.push(`Neutralizas ${pieceList(captured)}.`);
  if (converted.length) summaries.push(`Conviertes ${pieceList(converted)} a tu bando.`);
  if (fortressDamage)
    summaries.push(
      `La Fortaleza rival pierde ${fortressDamage} ${fortressDamage === 1 ? 'punto' : 'puntos'} de integridad.`,
    );
  if (lost.length) summaries.push(`Sacrificas ${pieceList(lost)}.`);
  if (newlyThreatened.length)
    summaries.push(`Quedan bajo amenaza inmediata: ${pieceList(newlyThreatened)}.`);
  if (!summaries.length) summaries.push('No hay capturas ni amenazas nuevas inmediatas.');

  let outcomeLabel: string | undefined;
  if (result.state.outcome?.type === 'win') {
    outcomeLabel = `${PLAYER_NAMES[result.state.outcome.winner]} gana la batalla.`;
  } else if (result.state.outcome?.type === 'draw') {
    outcomeLabel = 'La batalla termina en tablas.';
  }

  return {
    ok: true,
    actionLabel,
    summaries,
    captured,
    lost,
    converted,
    fortressDamage,
    newlyThreatened,
    outcomeLabel,
  };
}

function pieceList(pieces: Piece[]): string {
  const names = pieces.map((piece) => PIECE_NAMES[piece.type]);
  if (names.length <= 1) return names[0] ?? 'la unidad';
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}

export function consequenceTone(
  consequence: ActionConsequences,
): 'decisive' | 'warning' | 'favorable' | 'neutral' {
  if (consequence.outcomeLabel) return 'decisive';
  if (consequence.lost.length || consequence.newlyThreatened.length) return 'warning';
  if (consequence.captured.length || consequence.converted.length || consequence.fortressDamage)
    return 'favorable';
  return 'neutral';
}
