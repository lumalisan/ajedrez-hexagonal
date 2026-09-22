import {
  applyAction,
  getAllLegalActions,
  getFiringRangeCells,
  getPiece,
  type ActionResolutionRules,
} from './engine';
import { actionKey } from './action-identity';
import { BOARD_RADIUS, hexDistance, hexKey } from './hex';
import type {
  AiDifficulty,
  AiPersonality,
  GameAction,
  GameState,
  Piece,
  PieceType,
  Player,
} from './types';

const MATE_SCORE = 1_000_000;
const TIMEOUT_CHECK_INTERVAL = 64;
const MAX_SEARCH_MOVES = 24;
const MAX_ROOT_SEARCH_MOVES = 40;

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
  personality: AiPersonality;
  deadline: number;
  nodes: number;
  table: Map<string, Transposition>;
  killers: Map<number, string[]>;
  evaluation: WeakMap<GameState, number>;
  fortressThreats: WeakMap<GameState, Map<Player, boolean>>;
  variationWindow: number;
  maxMoves: number;
  maxRootMoves: number;
  tacticalDepth: number;
  rootMustDefend: boolean;
  resolutionRules?: Readonly<ActionResolutionRules>;
}

interface Transposition {
  depth: number;
  score: number;
  flag: 'exact' | 'lower' | 'upper';
  actionKey?: string;
}

interface OrderedAction {
  action: GameAction;
  key: string;
  state: GameState;
  tactical: boolean;
  score: number;
}

class SearchTimeout extends Error {}

export interface ActionChoiceOptions {
  /** Reproducible source of controlled variety between near-equivalent orders. */
  seed?: number;
  personality?: AiPersonality;
  difficulty?: AiDifficulty;
  resolutionRules?: Readonly<ActionResolutionRules>;
}

export interface SearchMetadata {
  requestedDepth: number;
  completedDepth: number;
  nodes: number;
  elapsedMs: number;
  timedOut: boolean;
  score: number | null;
  candidatesConsidered: number;
}

export interface SearchResult {
  action: GameAction | null;
  metadata: SearchMetadata;
}

interface ScoredAction {
  action: GameAction;
  score: number;
}

interface EvaluationWeights {
  material: number;
  ownFortress: number;
  enemyFortress: number;
  advance: number;
  defense: number;
  center: number;
  support: number;
  airPressure: number;
  ambushPressure: number;
  tactics: number;
}

const PERSONALITY_WEIGHTS: Record<AiPersonality, EvaluationWeights> = {
  balanced: {
    material: 1,
    ownFortress: 7_500,
    enemyFortress: 7_500,
    advance: 1,
    defense: 1,
    center: 1,
    support: 1,
    airPressure: 1,
    ambushPressure: 0,
    tactics: 1,
  },
  aggressive: {
    material: 0.95,
    ownFortress: 6_000,
    enemyFortress: 9_500,
    advance: 1.65,
    defense: 0.55,
    center: 1.1,
    support: 0.8,
    airPressure: 1.45,
    ambushPressure: 0.45,
    tactics: 1.15,
  },
  guardian: {
    material: 1.05,
    ownFortress: 10_500,
    enemyFortress: 5_500,
    advance: 0.65,
    defense: 2.25,
    center: 0.8,
    support: 1.4,
    airPressure: 0.7,
    ambushPressure: 0,
    tactics: 0.95,
  },
  ambush: {
    material: 1,
    ownFortress: 7_000,
    enemyFortress: 7_800,
    advance: 0.9,
    defense: 0.7,
    center: 0.4,
    support: 0.75,
    airPressure: 1.8,
    ambushPressure: 2.5,
    tactics: 1.1,
  },
};

const VARIATION: Record<AiDifficulty, { window: number; temperature: number; limit: number }> = {
  recruit: { window: 110, temperature: 55, limit: 6 },
  tactical: { window: 35, temperature: 18, limit: 4 },
  commander: { window: 18, temperature: 8, limit: 4 },
  expert: { window: 10, temperature: 4, limit: 4 },
};

/** Selects a legal move using a quick one-ply evaluation (Recluta). */
export function chooseMachineAction(
  state: GameState,
  options: ActionChoiceOptions = {},
): GameAction | null {
  const actions = getAllLegalActions(state);
  if (actions.length === 0) return null;

  const player = state.activePlayer;
  const personality = options.personality ?? 'balanced';
  const ordered = orderActions(
    state,
    actions,
    player,
    personality,
    undefined,
    options.resolutionRules,
  );
  const random = createSeededRandom(seedForState(options.seed, state));
  return chooseNearBest(
    ordered.map(({ action, score }) => ({ action, score })),
    options.difficulty ?? 'recruit',
    random,
  );
}

export interface SearchOptions {
  /** Maximum number of complete plies. Iterative deepening may stop earlier. */
  depth: number;
  budgetMs: number;
  seed?: number;
  personality?: AiPersonality;
  difficulty?: AiDifficulty;
  resolutionRules?: Readonly<ActionResolutionRules>;
  /** Called after each completed iteration with a read-only search snapshot. */
  onProgress?: (metadata: Readonly<SearchMetadata>) => void;
}

/**
 * Iterative-deepening alpha-beta search.
 *
 * Only a fully completed iteration is accepted. This is important: using values
 * from a half-searched depth made the old AI overlook simple replies whenever
 * its clock expired. Tactical leaf extensions reduce the usual horizon effect.
 */
export function searchMachineAction(state: GameState, options: SearchOptions): GameAction | null {
  return searchMachineActionWithMetadata(state, options).action;
}

/** Performs the same search while exposing timing/depth data for UI and diagnostics. */
export function searchMachineActionWithMetadata(
  state: GameState,
  options: SearchOptions,
): SearchResult {
  const startedAt = performance.now();
  const actions = getAllLegalActions(state);
  const requestedDepth = Math.max(1, options.depth);
  if (!actions.length) {
    return {
      action: null,
      metadata: {
        requestedDepth,
        completedDepth: 0,
        nodes: 0,
        elapsedMs: performance.now() - startedAt,
        timedOut: false,
        score: null,
        candidatesConsidered: 0,
      },
    };
  }

  const context: SearchContext = {
    rootPlayer: state.activePlayer,
    personality: options.personality ?? 'balanced',
    deadline: performance.now() + Math.max(20, options.budgetMs),
    nodes: 0,
    table: new Map(),
    killers: new Map(),
    evaluation: new WeakMap(),
    fortressThreats: new WeakMap(),
    variationWindow: VARIATION[options.difficulty ?? 'expert'].window,
    maxMoves: (options.difficulty ?? 'expert') === 'expert' ? 28 : MAX_SEARCH_MOVES,
    maxRootMoves: (options.difficulty ?? 'expert') === 'expert' ? 48 : MAX_ROOT_SEARCH_MOVES,
    tacticalDepth: (options.difficulty ?? 'expert') === 'expert' ? 4 : 2,
    rootMustDefend: false,
    resolutionRules: options.resolutionRules,
  };
  context.rootMustDefend = hasImmediateFortressWin(state, otherPlayer(state.activePlayer), context);
  const initial = orderActions(state, actions, context.rootPlayer, context.personality, context);
  let ranked: ScoredAction[] = initial.map(({ action, score }) => ({ action, score }));
  let completedDepth = 0;
  let timedOut = false;

  for (let depth = 1; depth <= requestedDepth; depth += 1) {
    try {
      const result = searchRoot(initial, ranked, depth, context);
      ranked = result.ranked;
      completedDepth = depth;
      options.onProgress?.({
        requestedDepth,
        completedDepth,
        nodes: context.nodes,
        elapsedMs: performance.now() - startedAt,
        timedOut: false,
        score: ranked[0].score,
        candidatesConsidered: ranked.length,
      });
    } catch (error) {
      if (error instanceof SearchTimeout) {
        timedOut = true;
        break;
      }
      throw error;
    }
  }

  const random = createSeededRandom(seedForState(options.seed, state));
  const action = chooseNearBest(ranked, options.difficulty ?? 'expert', random);
  const metadata: SearchMetadata = {
    requestedDepth,
    completedDepth,
    nodes: context.nodes,
    elapsedMs: performance.now() - startedAt,
    timedOut,
    score: ranked[0]?.score ?? null,
    candidatesConsidered: ranked.length,
  };
  if (timedOut) options.onProgress?.(metadata);
  return { action, metadata };
}

function searchRoot(
  initial: OrderedAction[],
  previous: ScoredAction[],
  depth: number,
  context: SearchContext,
): { ranked: ScoredAction[] } {
  checkTime(context, true);
  const order = new Map(previous.map(({ action }, index) => [actionKey(action), index]));
  // The first complete iteration checks every order with tactical replies.
  // Deeper iterations concentrate on those results, retaining all forcing moves
  // and the best continuation for each unit instead of spending the clock on
  // dozens of equivalent tank facings.
  const seenPieces = new Set<string>();
  const ordered = [...initial]
    .sort((left, right) => (order.get(left.key) ?? Infinity) - (order.get(right.key) ?? Infinity))
    .filter((candidate, index) => {
      const firstForPiece = !seenPieces.has(candidate.action.pieceId);
      seenPieces.add(candidate.action.pieceId);
      return (
        depth === 1 ||
        context.rootMustDefend ||
        candidate.tactical ||
        firstForPiece ||
        index < context.maxRootMoves
      );
    });
  const ranked: ScoredAction[] = [];
  let alpha = Number.NEGATIVE_INFINITY;

  for (const candidate of ordered) {
    checkTime(context, true);
    const score = alphaBeta(
      candidate.state,
      depth - 1,
      // Fail-low values are upper bounds, not exact ties. Keep the complete
      // variety window open so an inferior bound can never win the final sort
      // or masquerade as a near-equivalent random choice.
      alpha - context.variationWindow - 1,
      Number.POSITIVE_INFINITY,
      context,
      1,
    );
    ranked.push({ action: candidate.action, score });
    alpha = Math.max(alpha, score);
  }
  ranked.sort(
    (left, right) =>
      right.score - left.score || actionKey(left.action).localeCompare(actionKey(right.action)),
  );
  return { ranked };
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
  if (depth <= 0) return quiescence(state, alpha, beta, context, ply, context.tacticalDepth);

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
  if (!actions.length) return evaluateSearchState(state, context);
  const maximizing = state.activePlayer === context.rootPlayer;
  const killers = context.killers.get(ply) ?? [];
  const mustDefend = hasImmediateFortressWin(state, otherPlayer(state.activePlayer), context);
  const candidates = selectSearchActions(
    state,
    actions,
    [...(cached?.actionKey ? [cached.actionKey] : []), ...killers],
    context.personality,
    mustDefend ? Infinity : context.maxMoves,
  );
  let bestScore = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  let bestActionKey: string | undefined;

  for (let index = 0; index < candidates.length; index += 1) {
    checkTime(context);
    const action = candidates[index];
    const result = applyAction(state, action, context.resolutionRules);
    if (!result.ok) continue;
    const tactical =
      result.events.some((event) =>
        ['destroy', 'convert', 'fortressDamage', 'intercept'].includes(event.type),
      ) || Boolean(result.state.outcome);
    let childDepth = depth - 1;
    // Search late, quiet moves one ply less, then re-search if they surprise us.
    const reduce = depth >= 3 && index >= 8 && !tactical && !mustDefend;
    if (reduce) childDepth -= 1;
    let score = alphaBeta(result.state, childDepth, alpha, beta, context, ply + 1);
    if (reduce && ((maximizing && score > alpha) || (!maximizing && score < beta))) {
      score = alphaBeta(result.state, depth - 1, alpha, beta, context, ply + 1);
    }

    if (maximizing ? score > bestScore : score < bestScore) {
      bestScore = score;
      bestActionKey = actionKey(action);
    }
    if (maximizing) alpha = Math.max(alpha, bestScore);
    else beta = Math.min(beta, bestScore);
    if (alpha >= beta) {
      if (!tactical) rememberKiller(context, ply, actionKey(action));
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
  // Even at the extension limit, a legal winning hit is not a static advantage.
  if (hasImmediateFortressWin(state, state.activePlayer, context)) {
    return maximizing ? MATE_SCORE - ply - 1 : -MATE_SCORE + ply + 1;
  }
  let value = evaluateSearchState(state, context);

  // A threatened last Fortress point is the equivalent of check: passing is
  // not a legal substitute for a defense, and a quiet block must be searched.
  const mustDefend = hasImmediateFortressWin(state, otherPlayer(state.activePlayer), context);
  if (remaining <= 0 && !mustDefend) return value;
  if (mustDefend) {
    value = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  } else if (maximizing) {
    if (value >= beta) return value;
    alpha = Math.max(alpha, value);
  } else {
    if (value <= alpha) return value;
    beta = Math.min(beta, value);
  }

  const tacticalActions = getAllLegalActions(state).filter(
    (action) => mustDefend || isTacticalAction(state, action),
  );
  const tactical = selectSearchActions(state, tacticalActions, [], context.personality, Infinity);
  for (const action of tactical) {
    checkTime(context);
    const candidate = applyAction(state, action, context.resolutionRules);
    if (!candidate.ok) continue;
    const leavesFortressLost =
      mustDefend &&
      !candidate.state.outcome &&
      candidate.state.activePlayer !== state.activePlayer &&
      hasImmediateFortressWin(candidate.state, otherPlayer(state.activePlayer), context);
    const score = candidate.state.outcome
      ? terminalScore(candidate.state, context.rootPlayer, ply + 1)
      : leavesFortressLost
        ? maximizing
          ? -MATE_SCORE + ply + 2
          : MATE_SCORE - ply - 2
        : remaining <= -2
          ? evaluateSearchState(candidate.state, context)
          : quiescence(candidate.state, alpha, beta, context, ply + 1, remaining - 1);
    value = maximizing ? Math.max(value, score) : Math.min(value, score);
    if (maximizing) alpha = Math.max(alpha, value);
    else beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return value;
}

function hasImmediateFortressWin(
  state: GameState,
  attacker: Player,
  context: SearchContext,
): boolean {
  const fortress = fortressOf(state, otherPlayer(attacker));
  if (!fortress || fortress.hp !== 1 || state.outcome) return false;
  const cached = context.fortressThreats.get(state)?.get(attacker);
  if (cached !== undefined) return cached;
  const attackingState =
    state.activePlayer === attacker ? state : { ...state, activePlayer: attacker };
  const threatened = getAllLegalActions(attackingState).some((action) => {
    if (!(
      ('targetId' in action && action.targetId === fortress.id) ||
      ('to' in action && action.to && hexKey(action.to) === hexKey(fortress.position))
    ))
      return false;
    const result = applyAction(attackingState, action, context.resolutionRules);
    return (
      result.ok && result.state.outcome?.type === 'win' && result.state.outcome.winner === attacker
    );
  });
  const threats = context.fortressThreats.get(state) ?? new Map<Player, boolean>();
  threats.set(attacker, threatened);
  context.fortressThreats.set(state, threats);
  return threatened;
}

function orderActions(
  state: GameState,
  actions: GameAction[],
  rootPlayer: Player,
  personality: AiPersonality,
  context?: SearchContext,
  resolutionRules: Readonly<ActionResolutionRules> | undefined = context?.resolutionRules,
): OrderedAction[] {
  const maximizing = state.activePlayer === rootPlayer;
  const weights = PERSONALITY_WEIGHTS[personality];
  return actions
    .map((action) => {
      const result = applyAction(state, action, resolutionRules);
      if (!result.ok) return null;
      const key = actionKey(action);
      const tacticalScore = tacticalDelta(state, result.state, state.activePlayer);
      let score = context
        ? evaluateSearchState(result.state, context)
        : evaluateState(result.state, rootPlayer, personality);
      score += (maximizing ? tacticalScore : -tacticalScore) * weights.tactics;
      score += (maximizing ? 1 : -1) * stableActionBias(action, state.ply);
      return {
        action,
        key,
        state: result.state,
        tactical:
          result.events.some((event) =>
            ['destroy', 'convert', 'fortressDamage', 'intercept'].includes(event.type),
          ) || Boolean(result.state.outcome),
        score,
      };
    })
    .filter((candidate): candidate is OrderedAction => candidate !== null)
    .sort((left, right) => (maximizing ? right.score - left.score : left.score - right.score));
}

function evaluateSearchState(state: GameState, context: SearchContext): number {
  const cached = context.evaluation.get(state);
  if (cached !== undefined) return cached;
  const score = evaluateState(state, context.rootPlayer, context.personality);
  context.evaluation.set(state, score);
  return score;
}

function evaluateState(state: GameState, player: Player, personality: AiPersonality): number {
  if (state.outcome) return terminalScore(state, player, 0);
  const weights = PERSONALITY_WEIGHTS[personality];
  const enemy = otherPlayer(player);
  const ownFortress = fortressOf(state, player);
  const enemyFortress = fortressOf(state, enemy);
  let score =
    (ownFortress?.hp ?? 0) * weights.ownFortress - (enemyFortress?.hp ?? 0) * weights.enemyFortress;

  for (const piece of state.pieces) {
    if (piece.type === 'fortress') continue;
    const sign = piece.owner === player ? 1 : -1;
    const targetFortress = piece.owner === player ? enemyFortress : ownFortress;
    const homeFortress = piece.owner === player ? ownFortress : enemyFortress;
    score += sign * materialValue(piece) * weights.material;

    if (targetFortress) {
      const advance = BOARD_RADIUS * 2 + 1 - hexDistance(piece.position, targetFortress.position);
      score += sign * advance * positionalAdvance(piece.type) * weights.advance;
    }
    if (homeFortress) {
      const defense = Math.max(0, 4 - hexDistance(piece.position, homeFortress.position));
      score += sign * defense * positionalDefense(piece.type) * weights.defense;
    }
    const centerDistance = hexDistance(piece.position, { q: 0, r: 0 });
    score += sign * (BOARD_RADIUS - centerDistance) * 2 * weights.center;
    score += sign * supportScore(state, piece) * weights.support;
    if (weights.ambushPressure > 0)
      score += sign * ambushPressureScore(state, piece) * weights.ambushPressure;
    if (piece.type === 'airplane' || piece.type === 'medium' || piece.type === 'long')
      score +=
        sign *
        firingPressureScore(state, piece) *
        (piece.type === 'airplane' ? weights.airPressure : 1);
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
  personality: AiPersonality,
  maxMoves: number,
): GameAction[] {
  const forced = new Set(forcedKeys);
  const priorities = new Map<GameAction, number>();
  const tactical: GameAction[] = [];
  const quiet: Array<{ action: GameAction; score: number; group: string }> = [];
  const enemyFortress = fortressOf(state, otherPlayer(state.activePlayer));
  const ownFortress = fortressOf(state, state.activePlayer);
  const weights = PERSONALITY_WEIGHTS[personality];

  for (const action of actions) {
    const key = actionKey(action);
    const actor = getPiece(state, action.pieceId);
    if (forced.has(key) || isTacticalAction(state, action)) {
      // These are ordering hints only. The engine resolves every explored move;
      // shields, conversion and sacrifices are never inferred as legal results.
      const target =
        'targetId' in action && action.targetId
          ? getPiece(state, action.targetId)
          : 'to' in action && action.to
            ? state.pieces.find(
                (piece) =>
                  piece.owner !== state.activePlayer &&
                  hexKey(piece.position) === hexKey(action.to!),
              )
            : undefined;
      const gain =
        target?.type === 'fortress'
          ? 90_000
          : target
            ? materialValue(target) * (action.kind === 'convert' ? 24 : 12)
            : 0;
      priorities.set(
        action,
        forced.has(key)
          ? 10_000_000 - forcedKeys.indexOf(key)
          : 100_000 + gain - (actor ? materialValue(actor) : 0),
      );
      tactical.push(action);
      continue;
    }
    let score = 0;
    if ('to' in action && action.to) {
      score += enemyFortress
        ? (BOARD_RADIUS * 2 - hexDistance(action.to, enemyFortress.position)) * 20 * weights.advance
        : 0;
      score += ownFortress
        ? Math.max(0, 4 - hexDistance(action.to, ownFortress.position)) * 8 * weights.defense
        : 0;
      score -= hexDistance(action.to, { q: 0, r: 0 }) * weights.center;
    }
    if (action.kind === 'orient' || action.kind === 'rotate') score -= 20;
    if (action.kind === 'transform')
      score -= actor ? Math.max(0, materialValue(actor) - PIECE_VALUE.soldier) : 45;
    if (actor?.type === 'medium' && (action.kind === 'move' || action.kind === 'orient')) {
      score += firingPressureScore(state, actor, {
        position: action.kind === 'move' ? action.to : actor.position,
        cannon: action.cannon,
      });
    }
    score += stableActionBias(action, state.ply);
    priorities.set(action, score);
    const destination = 'to' in action && action.to ? hexKey(action.to) : '-';
    quiet.push({ action, score, group: `${action.pieceId}:${action.kind}:${destination}` });
  }
  const byPriority = (left: GameAction, right: GameAction): number =>
    priorities.get(right)! - priorities.get(left)!;
  // In check (and at tactical leaves) even alternative cannon facings may be
  // the only defense. Infinity deliberately bypasses all grouping and pruning.
  if (actions.length <= maxMoves) return [...actions].sort(byPriority);
  quiet.sort((left, right) => right.score - left.score);
  const selected: GameAction[] = [...tactical];
  const groups = new Set<string>();
  const pieces = new Set<string>();
  // First preserve a quiet option for each unit. Then fill with distinct
  // destinations, choosing useful cannon facings before applying the cap.
  for (const candidate of quiet) {
    if (pieces.has(candidate.action.pieceId)) continue;
    if (selected.length >= maxMoves) break;
    pieces.add(candidate.action.pieceId);
    groups.add(candidate.group);
    selected.push(candidate.action);
  }
  for (const candidate of quiet) {
    if (selected.length >= maxMoves) break;
    if (groups.has(candidate.group)) continue;
    groups.add(candidate.group);
    selected.push(candidate.action);
  }
  return selected.sort(byPriority);
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
    .reduce((total, piece) => total + materialValue(piece) * 12, 0);
  score -= before.pieces
    .filter((piece) => piece.owner === mover && !afterIds.has(piece.id))
    .reduce((total, piece) => total + materialValue(piece) * 12, 0);
  for (const piece of after.pieces) {
    const previous = getPiece(before, piece.id);
    if (previous && previous.owner !== piece.owner) {
      score += (piece.owner === mover ? 1 : -1) * materialValue(piece) * 24;
    }
  }
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

function firingPressureScore(
  state: GameState,
  piece: Extract<Piece, { type: 'airplane' | 'medium' | 'long' }>,
  preview: Parameters<typeof getFiringRangeCells>[2] = {},
): number {
  // Skip expensive long-range shield ray checks when there is no target at all.
  if (
    piece.type === 'long' &&
    !state.pieces.some(
      (target) =>
        target.owner !== piece.owner && hexDistance(piece.position, target.position) === 3,
    )
  )
    return 0;
  const firingCells = new Set(getFiringRangeCells(state, piece.id, preview).map(hexKey));
  return state.pieces
    .filter(
      (target) =>
        target.owner !== piece.owner &&
        target.type !== 'antiAir' &&
        firingCells.has(hexKey(target.position)),
    )
    .reduce(
      (score, target) =>
        score +
        (target.type === 'fortress' ? (target.hp === 1 ? 240 : 100) : materialValue(target) * 0.12),
      0,
    );
}

function materialValue(piece: Piece): number {
  return piece.type === 'long'
    ? 180 + 110 * (piece.missilesRemaining ?? 2)
    : PIECE_VALUE[piece.type];
}

function ambushPressureScore(state: GameState, piece: Piece): number {
  const roleFactor: Record<PieceType, number> = {
    soldier: 0.35,
    capturer: 0.8,
    medium: 0.45,
    long: 0.6,
    fast: 1.2,
    drone: 1.1,
    airplane: 1.3,
    antiAir: 0.2,
    fortress: 0,
  };
  const factor = roleFactor[piece.type];
  if (factor === 0) return 0;
  let score = 0;
  for (const target of state.pieces) {
    if (target.owner === piece.owner || target.type === 'fortress') continue;
    const proximity = Math.max(0, 5 - hexDistance(piece.position, target.position));
    score += proximity * factor * Math.max(1, PIECE_VALUE[target.type] / 100);
  }
  return score;
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
      const ammunition = piece.type === 'long' ? (piece.missilesRemaining ?? 2) : '-';
      return `${piece.id}:${piece.owner}:${piece.type}:${piece.position.q},${piece.position.r}:${facing}:${cannon}:${hp}:${ammunition}`;
    })
    .sort()
    .join('|');
  return `${state.activePlayer}:${state.firstFortressDamageBy ?? '-'}:${state.noProgressPlyCount ?? 0}:${repetitionHash(state)}:${pieces}`;
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

function chooseNearBest(
  candidates: ScoredAction[],
  difficulty: AiDifficulty,
  random: () => number,
): GameAction | null {
  if (!candidates.length) return null;
  const ranked = [...candidates].sort(
    (left, right) =>
      right.score - left.score || actionKey(left.action).localeCompare(actionKey(right.action)),
  );
  const settings = VARIATION[difficulty];
  if (settings.limit === 1 || settings.temperature <= 0) return ranked[0].action;

  const bestScore = ranked[0].score;
  // Preserve forced wins and their distance, and never randomize a sound move
  // into a forced loss. Variety is for genuinely near-equivalent positions.
  if (Math.abs(bestScore) >= MATE_SCORE / 2) {
    const exact = ranked.filter(({ score }) => score === bestScore);
    return exact[Math.floor(random() * exact.length)].action;
  }
  const eligible = ranked
    .filter(({ score }) => bestScore - score <= settings.window)
    .slice(0, settings.limit);
  if (eligible.length === 1) return eligible[0].action;

  const weights = eligible.map(({ score }) =>
    Math.exp(Math.max(-20, (score - bestScore) / settings.temperature)),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let pick = random() * total;
  for (let index = 0; index < eligible.length; index += 1) {
    pick -= weights[index];
    if (pick <= 0) return eligible[index].action;
  }
  return eligible.at(-1)?.action ?? ranked[0].action;
}

/** Reproducible variety for a fixed position, seed and completed search depth. */
export function createSeededRandom(seed: number): () => number {
  let value = normalizeSeed(seed);
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function seedForState(seed: number | undefined, state: GameState): number {
  let hash = normalizeSeed(seed ?? 0) ^ Math.imul(state.ply + 1, 0x9e3779b1);
  const key = positionKey(state);
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 0x85ebca6b);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  return Math.trunc(seed) >>> 0;
}

function otherPlayer(player: Player): Player {
  return player === 0 ? 1 : 0;
}
