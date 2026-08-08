import { applyAction, getAllLegalActions, getFiringRangeCells, getPiece } from './engine';
import { actionKey } from './action-identity';
import { BOARD_RADIUS, hexDistance, hexKey } from './hex';
import type { GameAction, GameState, Piece, PieceType, Player } from './types';

const MATE_SCORE = 1_000_000;
const TIMEOUT_CHECK_INTERVAL = 64;
const MAX_SEARCH_MOVES = 24;

const PIECE_VALUE: Record<PieceType, number> = {
  soldier: 100,
  capturer: 320,
  medium: 420,
  long: 400,
  fast: 500,
  drone: 450,
  airplane: 460,
  antiAir: 300,
  fortress: 0,
};

interface SearchContext {
  rootPlayer: Player;
  deadline: number;
  nodes: number;
  table: Map<string, Transposition>;
  killers: Map<number, string[]>;
}

interface Transposition {
  depth: number;
  score: number;
  flag: 'exact' | 'lower' | 'upper';
  actionKey?: string;
}

interface OrderedAction {
  action: GameAction;
  state: GameState;
  tactical: boolean;
  score: number;
}

class SearchTimeout extends Error {}

/** Selects a legal move using a quick one-ply evaluation (Recluta). */
export function chooseMachineAction(state: GameState): GameAction | null {
  const actions = getAllLegalActions(state);
  if (actions.length === 0) return null;

  const player = state.activePlayer;
  const ordered = orderActions(state, actions, player, 0);
  return ordered[0]?.action ?? actions[0];
}

export interface SearchOptions {
  /** Maximum number of complete plies. Iterative deepening may stop earlier. */
  depth: number;
  budgetMs: number;
  seed?: number;
}

/**
 * Iterative-deepening alpha-beta search.
 *
 * Only a fully completed iteration is accepted. This is important: using values
 * from a half-searched depth made the old AI overlook simple replies whenever
 * its clock expired. Tactical leaf extensions reduce the usual horizon effect.
 */
export function searchMachineAction(state: GameState, options: SearchOptions): GameAction | null {
  const actions = getAllLegalActions(state);
  if (!actions.length) return null;

  const context: SearchContext = {
    rootPlayer: state.activePlayer,
    deadline: performance.now() + Math.max(20, options.budgetMs),
    nodes: 0,
    table: new Map(),
    killers: new Map(),
  };
  const initial = orderActions(state, actions, context.rootPlayer, 0);
  let best = initial[0]?.action ?? actions[0];
  let preferred = actionKey(best);

  for (let depth = 1; depth <= Math.max(1, options.depth); depth += 1) {
    try {
      const result = searchRoot(state, actions, depth, context, preferred);
      best = result.action;
      preferred = actionKey(best);
    } catch (error) {
      if (error instanceof SearchTimeout) break;
      throw error;
    }
  }
  return best;
}

function searchRoot(
  state: GameState,
  actions: GameAction[],
  depth: number,
  context: SearchContext,
  preferred: string,
): { action: GameAction; score: number } {
  checkTime(context, true);
  const ordered = orderActions(state, actions, context.rootPlayer, 0, preferred);
  let best = ordered[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  let alpha = Number.NEGATIVE_INFINITY;

  for (const candidate of ordered) {
    checkTime(context, true);
    const score = alphaBeta(
      candidate.state,
      depth - 1,
      alpha,
      Number.POSITIVE_INFINITY,
      context,
      1,
    );
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
    alpha = Math.max(alpha, score);
  }
  return { action: best.action, score: bestScore };
}

function alphaBeta(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  context: SearchContext,
  ply: number,
): number {
  checkTime(context);
  if (state.outcome) return terminalScore(state, context.rootPlayer, ply);
  if (depth <= 0) return quiescence(state, alpha, beta, context, ply, 2);

  const key = positionKey(state);
  const cached = context.table.get(key);
  const originalAlpha = alpha;
  const originalBeta = beta;
  if (cached && cached.depth >= depth) {
    if (cached.flag === 'exact') return cached.score;
    if (cached.flag === 'lower') alpha = Math.max(alpha, cached.score);
    if (cached.flag === 'upper') beta = Math.min(beta, cached.score);
    if (alpha >= beta) return cached.score;
  }

  const actions = getAllLegalActions(state);
  if (!actions.length) return evaluateState(state, context.rootPlayer);
  const maximizing = state.activePlayer === context.rootPlayer;
  const killers = context.killers.get(ply) ?? [];
  const candidates = selectSearchActions(state, actions, [
    ...(cached?.actionKey ? [cached.actionKey] : []),
    ...killers,
  ]);
  const ordered = orderActions(
    state,
    candidates,
    context.rootPlayer,
    ply,
    cached?.actionKey,
    killers,
  );
  let bestScore = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  let bestActionKey: string | undefined;

  for (let index = 0; index < ordered.length; index += 1) {
    const candidate = ordered[index];
    let childDepth = depth - 1;
    // Search late, quiet moves one ply less, then re-search if they surprise us.
    const reduce = depth >= 3 && index >= 8 && !candidate.tactical;
    if (reduce) childDepth -= 1;
    let score = alphaBeta(candidate.state, childDepth, alpha, beta, context, ply + 1);
    if (reduce && ((maximizing && score > alpha) || (!maximizing && score < beta))) {
      score = alphaBeta(candidate.state, depth - 1, alpha, beta, context, ply + 1);
    }

    if (maximizing ? score > bestScore : score < bestScore) {
      bestScore = score;
      bestActionKey = actionKey(candidate.action);
    }
    if (maximizing) alpha = Math.max(alpha, bestScore);
    else beta = Math.min(beta, bestScore);
    if (alpha >= beta) {
      if (!candidate.tactical) rememberKiller(context, ply, actionKey(candidate.action));
      break;
    }
  }

  const flag = bestScore <= originalAlpha ? 'upper' : bestScore >= originalBeta ? 'lower' : 'exact';
  context.table.set(key, { depth, score: bestScore, flag, actionKey: bestActionKey });
  return bestScore;
}

function quiescence(
  state: GameState,
  alpha: number,
  beta: number,
  context: SearchContext,
  ply: number,
  remaining: number,
): number {
  checkTime(context);
  if (state.outcome) return terminalScore(state, context.rootPlayer, ply);

  const maximizing = state.activePlayer === context.rootPlayer;
  let value = evaluateState(state, context.rootPlayer);
  if (maximizing) {
    if (value >= beta) return value;
    alpha = Math.max(alpha, value);
  } else {
    if (value <= alpha) return value;
    beta = Math.min(beta, value);
  }
  if (remaining <= 0) return value;

  const tacticalActions = getAllLegalActions(state).filter((action) =>
    isTacticalAction(state, action),
  );
  const tactical = orderActions(state, tacticalActions, context.rootPlayer, ply).filter(
    (candidate) => candidate.tactical,
  );
  for (const candidate of tactical) {
    const score = quiescence(candidate.state, alpha, beta, context, ply + 1, remaining - 1);
    value = maximizing ? Math.max(value, score) : Math.min(value, score);
    if (maximizing) alpha = Math.max(alpha, value);
    else beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return value;
}

function orderActions(
  state: GameState,
  actions: GameAction[],
  rootPlayer: Player,
  ply: number,
  preferred?: string,
  killers: string[] = [],
): OrderedAction[] {
  const maximizing = state.activePlayer === rootPlayer;
  return actions
    .map((action) => {
      const result = applyAction(state, action);
      if (!result.ok) return null;
      const key = actionKey(action);
      const tacticalScore = tacticalDelta(state, result.state, state.activePlayer);
      let score = evaluateState(result.state, rootPlayer);
      score += maximizing ? tacticalScore : -tacticalScore;
      if (key === preferred) score += maximizing ? 10_000_000 : -10_000_000;
      else if (killers.includes(key)) score += maximizing ? 500_000 : -500_000;
      score += (maximizing ? 1 : -1) * stableActionBias(action, ply);
      return {
        action,
        state: result.state,
        tactical: tacticalScore > 0 || Boolean(result.state.outcome),
        score,
      };
    })
    .filter((candidate): candidate is OrderedAction => candidate !== null)
    .sort((left, right) => (maximizing ? right.score - left.score : left.score - right.score));
}

function evaluateState(state: GameState, player: Player): number {
  if (state.outcome) return terminalScore(state, player, 0);
  const enemy = otherPlayer(player);
  const ownFortress = fortressOf(state, player);
  const enemyFortress = fortressOf(state, enemy);
  let score = ((ownFortress?.hp ?? 0) - (enemyFortress?.hp ?? 0)) * 7_500;

  for (const piece of state.pieces) {
    if (piece.type === 'fortress') continue;
    const sign = piece.owner === player ? 1 : -1;
    const targetFortress = piece.owner === player ? enemyFortress : ownFortress;
    const homeFortress = piece.owner === player ? ownFortress : enemyFortress;
    score += sign * PIECE_VALUE[piece.type];

    if (targetFortress) {
      const advance = BOARD_RADIUS * 2 + 1 - hexDistance(piece.position, targetFortress.position);
      score += sign * advance * positionalAdvance(piece.type);
    }
    if (homeFortress) {
      const defense = Math.max(0, 4 - hexDistance(piece.position, homeFortress.position));
      score += sign * defense * positionalDefense(piece.type);
    }
    const centerDistance = hexDistance(piece.position, { q: 0, r: 0 });
    score += sign * (BOARD_RADIUS - centerDistance) * 2;
    score += sign * supportScore(state, piece);
    if (piece.type === 'airplane') score += sign * airplanePressureScore(state, piece);
  }
  return score;
}

/**
 * Hexagonal positions can expose hundreds of mostly equivalent facing choices.
 * Keep every forcing move and the most promising quiet moves. Principal-variation
 * and killer moves are never discarded.
 */
function selectSearchActions(
  state: GameState,
  actions: GameAction[],
  forcedKeys: string[],
): GameAction[] {
  if (actions.length <= MAX_SEARCH_MOVES) return actions;
  const forced = new Set(forcedKeys);
  const tactical: GameAction[] = [];
  const quiet: Array<{ action: GameAction; score: number }> = [];
  const enemyFortress = fortressOf(state, otherPlayer(state.activePlayer));

  for (const action of actions) {
    const key = actionKey(action);
    if (forced.has(key) || isTacticalAction(state, action)) {
      tactical.push(action);
      continue;
    }
    let score = 0;
    if ('to' in action && action.to) {
      score += enemyFortress
        ? (BOARD_RADIUS * 2 - hexDistance(action.to, enemyFortress.position)) * 20
        : 0;
      score -= hexDistance(action.to, { q: 0, r: 0 });
    }
    if (action.kind === 'orient' || action.kind === 'rotate') score -= 80;
    if (action.kind === 'transform') score -= 45;
    score += stableActionBias(action, state.ply);
    quiet.push({ action, score });
  }
  quiet.sort((left, right) => right.score - left.score);
  return [
    ...tactical,
    ...quiet.slice(0, Math.max(0, MAX_SEARCH_MOVES - tactical.length)).map(({ action }) => action),
  ];
}

function isTacticalAction(state: GameState, action: GameAction): boolean {
  if (
    action.kind === 'shoot' ||
    action.kind === 'convert' ||
    action.kind === 'attackAbove' ||
    action.kind === 'attackBelow' ||
    (action.kind === 'transform' && Boolean(action.attackAboveId))
  ) {
    return true;
  }
  if (!('to' in action) || !action.to) return false;
  const actor = getPiece(state, action.pieceId);
  if (actor?.type === 'airplane' && action.kind === 'move' && !action.kamikaze) return false;
  return state.pieces.some(
    (piece) =>
      piece.owner !== state.activePlayer &&
      piece.position.q === action.to?.q &&
      piece.position.r === action.to?.r,
  );
}

function tacticalDelta(before: GameState, after: GameState, mover: Player): number {
  if (after.outcome?.type === 'win')
    return after.outcome.winner === mover ? MATE_SCORE : -MATE_SCORE;
  const enemy = otherPlayer(mover);
  const afterIds = new Set(after.pieces.map((piece) => piece.id));
  let score = before.pieces
    .filter((piece) => piece.owner === enemy && !afterIds.has(piece.id))
    .reduce((total, piece) => total + PIECE_VALUE[piece.type] * 12, 0);
  score -= before.pieces
    .filter((piece) => piece.owner === mover && !afterIds.has(piece.id))
    .reduce((total, piece) => total + PIECE_VALUE[piece.type] * 12, 0);
  const oldFortress = fortressOf(before, enemy);
  const newFortress = fortressOf(after, enemy);
  score += ((oldFortress?.hp ?? 0) - (newFortress?.hp ?? 0)) * 90_000;
  return score;
}

function supportScore(state: GameState, piece: Piece): number {
  let score = 0;
  for (const ally of state.pieces) {
    if (ally.id === piece.id || ally.owner !== piece.owner) continue;
    const distance = hexDistance(piece.position, ally.position);
    if (ally.type === 'antiAir' && distance <= 1)
      score += piece.type === 'drone' || piece.type === 'airplane' ? 18 : 8;
    if (ally.type === 'capturer' && piece.type === 'capturer' && distance === 1) score += 14;
  }
  return score;
}

function airplanePressureScore(
  state: GameState,
  airplane: Extract<Piece, { type: 'airplane' }>,
): number {
  const firingCells = new Set(getFiringRangeCells(state, airplane.id).map(hexKey));
  return state.pieces
    .filter(
      (target) =>
        target.owner !== airplane.owner &&
        target.type !== 'antiAir' &&
        firingCells.has(hexKey(target.position)),
    )
    .reduce(
      (score, target) =>
        score + (target.type === 'fortress' ? 80 : Math.max(5, PIECE_VALUE[target.type] / 20)),
      0,
    );
}

function positionalAdvance(type: PieceType): number {
  if (type === 'capturer') return 8;
  if (type === 'fast' || type === 'drone' || type === 'airplane') return 5;
  if (type === 'soldier') return 4;
  return 3;
}

function positionalDefense(type: PieceType): number {
  if (type === 'antiAir') return 9;
  if (type === 'long' || type === 'medium') return 5;
  return 2;
}

function terminalScore(state: GameState, player: Player, ply: number): number {
  if (state.outcome?.type === 'win')
    return state.outcome.winner === player ? MATE_SCORE - ply : -MATE_SCORE + ply;
  return 0;
}

function fortressOf(
  state: GameState,
  owner: Player,
): Extract<Piece, { type: 'fortress' }> | undefined {
  return state.pieces.find(
    (piece): piece is Extract<Piece, { type: 'fortress' }> =>
      piece.owner === owner && piece.type === 'fortress',
  );
}

function positionKey(state: GameState): string {
  const pieces = state.pieces
    .map((piece) => {
      const facing = piece.type === 'soldier' || piece.type === 'airplane' ? piece.facing : '-';
      const cannon = piece.type === 'medium' ? piece.cannon : '-';
      const hp = piece.type === 'fortress' ? piece.hp : '-';
      return `${piece.id}:${piece.owner}:${piece.type}:${piece.position.q},${piece.position.r}:${facing}:${cannon}:${hp}`;
    })
    .sort()
    .join('|');
  return `${state.activePlayer}:${state.firstFortressDamageBy ?? '-'}:${repetitionHash(state)}:${pieces}`;
}

function repetitionHash(state: GameState): number {
  let hash = 0;
  for (const [position, count] of Object.entries(state.positionCounts).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (let index = 0; index < position.length; index += 1) {
      hash = (hash * 31 + position.charCodeAt(index)) | 0;
    }
    hash = (hash * 31 + count) | 0;
  }
  return hash;
}

function rememberKiller(context: SearchContext, ply: number, key: string): void {
  const current = context.killers.get(ply) ?? [];
  context.killers.set(ply, [key, ...current.filter((candidate) => candidate !== key)].slice(0, 2));
}

function checkTime(context: SearchContext, force = false): void {
  context.nodes += 1;
  if (
    (force || context.nodes % TIMEOUT_CHECK_INTERVAL === 0) &&
    performance.now() >= context.deadline
  ) {
    throw new SearchTimeout();
  }
}

function stableActionBias(action: GameAction, ply: number): number {
  const key = actionKey(action);
  let hash = ply;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return (Math.abs(hash) % 1000) / 1_000_000;
}

function otherPlayer(player: Player): Player {
  return player === 0 ? 1 : 0;
}
