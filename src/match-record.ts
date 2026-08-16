import {
  applyAction,
  cloneState,
  createGameState,
  validateState,
  type ActionResolutionRules,
} from './engine';
import { assertValidMatchConfig } from './game-config';
import { createMatchClock, validateMatchClock } from './match-clock';
import type {
  AcademySessionMetadata,
  GameAction,
  GameEvent,
  GameState,
  MatchClockSnapshot,
  MatchConfig,
  MatchRecord,
  MatchStatistics,
  Outcome,
} from './types';

export class ReplayError extends Error {}

export function createMatchRecord(
  config: MatchRecord['config'],
  initialState?: GameState,
): MatchRecord {
  assertValidMatchConfig(config);
  const state =
    initialState ??
    createGameState(
      config.setup.map(({ piece }) => structuredClone(piece)),
      0,
    );
  const errors = validateState(state, config);
  if (errors.length) throw new Error(`Estado inicial inválido: ${errors.join(' ')}`);
  const now = new Date().toISOString();
  return {
    version: 2,
    config: structuredClone(config),
    initialState: cloneState(state),
    actions: [],
    currentAction: 0,
    conclusion: null,
    clock:
      config.options.clockSeconds === null
        ? null
        : createMatchClock(config.options.clockSeconds, state.activePlayer),
    createdAt: now,
    updatedAt: now,
  };
}

export function appendAction(record: MatchRecord, action: GameAction): MatchRecord {
  const actions = record.actions.slice(0, record.currentAction);
  actions.push(structuredClone(action));
  return {
    ...record,
    actions,
    currentAction: actions.length,
    conclusion: null,
    updatedAt: new Date().toISOString(),
  };
}

export function replayRecord(record: MatchRecord, actionCount = record.currentAction): GameState {
  if (record.version !== 2) throw new ReplayError('Versión de repetición incompatible.');
  assertValidMatchConfig(record.config);
  if (!Number.isInteger(actionCount) || actionCount < 0 || actionCount > record.actions.length)
    throw new ReplayError('Índice de repetición inválido.');
  let state = cloneState(record.initialState);
  const initialErrors = validateState(state, record.config);
  if (initialErrors.length) throw new ReplayError(initialErrors.join(' '));
  for (let index = 0; index < actionCount; index += 1) {
    const result = applyAction(
      state,
      record.actions[index],
      resolutionRulesForConfig(record.config),
    );
    if (!result.ok)
      throw new ReplayError(
        `Acción ilegal en el paso ${index + 1}: ${result.error ?? 'rechazada'}`,
      );
    state = result.state;
  }
  if (record.conclusion && actionCount >= record.conclusion.atAction) {
    if (state.outcome && !sameOutcome(state.outcome, record.conclusion.outcome))
      throw new ReplayError('La conclusión guardada contradice el resultado del tablero.');
    state.outcome = structuredClone(record.conclusion.outcome);
  }
  return state;
}

export function setReplayCursor(record: MatchRecord, currentAction: number): MatchRecord {
  replayRecord(record, currentAction);
  return { ...record, currentAction };
}

export function serializeRecord(record: MatchRecord): string {
  validateRecordMetadata(record);
  replayRecord(record, record.actions.length);
  replayRecord(record);
  return JSON.stringify(record, null, 2);
}

export function parseRecord(value: string): MatchRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ReplayError('El archivo no contiene JSON válido.');
  }
  if (!parsed || typeof parsed !== 'object' || !('version' in parsed))
    throw new ReplayError('El archivo no es una repetición de Protocolo Hexagonal.');
  const candidate = parsed as MatchRecord;
  if (candidate.version !== 2) throw new ReplayError('Versión de guardado incompatible.');
  if (!Array.isArray(candidate.actions))
    throw new ReplayError('El diario de acciones no es válido.');
  validateRecordMetadata(candidate);
  replayRecord(candidate, candidate.actions.length);
  replayRecord(candidate);
  return candidate;
}

/** Stores a terminal result that did not come from a GameAction. */
export function concludeMatch(record: MatchRecord, outcome: Outcome): MatchRecord {
  const actions = record.actions.slice(0, record.currentAction);
  const base = { ...record, actions, conclusion: null };
  const state = replayRecord(base, actions.length);
  if (state.outcome && !sameOutcome(state.outcome, outcome))
    throw new ReplayError('La partida ya tiene un resultado diferente.');
  if (!state.outcome && isBoardGeneratedOutcome(outcome))
    throw new ReplayError('Ese resultado debe proceder de una orden legal del tablero.');
  const next: MatchRecord = {
    ...record,
    actions,
    currentAction: actions.length,
    conclusion: {
      outcome: structuredClone(outcome),
      atAction: actions.length,
      recordedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
  replayRecord(next);
  return next;
}

/** Replaces the persisted clock snapshot after runtime validation. */
export function setMatchClock(record: MatchRecord, clock: MatchClockSnapshot | null): MatchRecord {
  if (clock) {
    const errors = validateMatchClock(clock);
    if (errors.length) throw new ReplayError(errors.join(' '));
    if (
      record.config.options.clockSeconds === null ||
      record.config.options.clockSeconds === undefined
    )
      throw new ReplayError('La partida no tiene reloj configurado.');
    if (clock.initialMs !== Math.round(record.config.options.clockSeconds * 1_000))
      throw new ReplayError('El reloj no coincide con la duración configurada.');
  }
  return {
    ...record,
    clock: clock ? structuredClone(clock) : null,
    updatedAt: new Date().toISOString(),
  };
}

/** Replaces portable Academy hint progress without mutating the replay. */
export function setAcademySession(
  record: MatchRecord,
  academySession: AcademySessionMetadata | null,
): MatchRecord {
  if (academySession !== null) validateAcademySession(academySession);
  return {
    ...record,
    academySession: academySession === null ? null : structuredClone(academySession),
    updatedAt: new Date().toISOString(),
  };
}

export function resolutionRulesForConfig(config: MatchConfig): ActionResolutionRules {
  return {
    repetition: config.victory.repetition > 0 ? config.victory.repetition : null,
    // Missing means this is a legacy v2 recording created before the rule existed.
    noProgressPlyLimit: config.options.noProgressPlyLimit ?? null,
  };
}

export function calculateStatistics(record: MatchRecord): MatchStatistics {
  const stats: MatchStatistics = {
    plies: record.currentAction,
    captures: [0, 0],
    fortressDamage: [0, 0],
    transformations: [0, 0],
    startedAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  let state = cloneState(record.initialState);
  for (const action of record.actions.slice(0, record.currentAction)) {
    const result = applyAction(state, action, resolutionRulesForConfig(record.config));
    if (!result.ok) break;
    collectEvents(stats, state, result.events);
    state = result.state;
  }
  return stats;
}

function collectEvents(stats: MatchStatistics, before: GameState, events: GameEvent[]): void {
  for (const event of events) {
    if (
      (event.type === 'destroy' || event.type === 'intercept') &&
      event.owner !== undefined &&
      before.pieces.find((piece) => piece.id === event.targetId)?.type !== 'fortress'
    )
      stats.captures[event.owner] += 1;
    if (event.type === 'fortressDamage' && event.owner !== undefined)
      stats.fortressDamage[event.owner] += event.amount ?? 1;
    if (event.type === 'transform' && event.owner !== undefined)
      stats.transformations[event.owner] += 1;
  }
}

function validateRecordMetadata(record: MatchRecord): void {
  if (record.academySession !== undefined && record.academySession !== null)
    validateAcademySession(record.academySession);
  if (record.conclusion) {
    if (
      !Number.isInteger(record.conclusion.atAction) ||
      record.conclusion.atAction < 0 ||
      record.conclusion.atAction !== record.actions.length
    )
      throw new ReplayError('La conclusión no coincide con el final del diario.');
    if (!isOutcome(record.conclusion.outcome))
      throw new ReplayError('La conclusión de la partida no es válida.');
    if (!Number.isFinite(Date.parse(record.conclusion.recordedAt)))
      throw new ReplayError('La fecha de conclusión no es válida.');
  }
  if (record.clock) {
    const errors = validateMatchClock(record.clock);
    if (errors.length) throw new ReplayError(errors.join(' '));
    if (
      record.config.options.clockSeconds === null ||
      record.config.options.clockSeconds === undefined ||
      record.clock.initialMs !== Math.round(record.config.options.clockSeconds * 1_000)
    )
      throw new ReplayError('El reloj no coincide con la duración configurada.');
  }
}

function validateAcademySession(value: unknown): asserts value is AcademySessionMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ReplayError('La sesión de Academia no es válida.');
  const candidate = value as Partial<AcademySessionMetadata>;
  if (
    typeof candidate.scenarioId !== 'string' ||
    !candidate.scenarioId.trim() ||
    candidate.scenarioId !== candidate.scenarioId.trim()
  )
    throw new ReplayError('El identificador del escenario de Academia no es válido.');
  if (!Number.isSafeInteger(candidate.hintsRevealed) || candidate.hintsRevealed! < 0)
    throw new ReplayError('El número de pistas reveladas no es válido.');
}

function isOutcome(value: unknown): value is Outcome {
  if (!value || typeof value !== 'object' || !('type' in value) || !('reason' in value))
    return false;
  const candidate = value as { type: unknown; reason: unknown; winner?: unknown };
  if (candidate.type === 'draw')
    return ['blockade', 'repetition', 'no-progress'].includes(String(candidate.reason));
  return (
    candidate.type === 'win' &&
    (candidate.winner === 0 || candidate.winner === 1) &&
    ['fortress', 'resignation', 'timeout'].includes(String(candidate.reason))
  );
}

function isBoardGeneratedOutcome(outcome: Outcome): boolean {
  return (
    outcome.reason === 'fortress' ||
    outcome.reason === 'repetition' ||
    outcome.reason === 'no-progress'
  );
}

function sameOutcome(left: Outcome, right: Outcome): boolean {
  return (
    left.type === right.type &&
    left.reason === right.reason &&
    (left.type === 'draw' || (right.type === 'win' && left.winner === right.winner))
  );
}
