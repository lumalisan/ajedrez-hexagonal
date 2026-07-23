import { applyAction, cloneState, createGameState, validateState } from './engine';
import { assertValidMatchConfig } from './game-config';
import type { GameAction, GameEvent, GameState, MatchRecord, MatchStatistics } from './types';

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
    version: 1,
    config: structuredClone(config),
    initialState: cloneState(state),
    actions: [],
    currentAction: 0,
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
    updatedAt: new Date().toISOString(),
  };
}

export function replayRecord(record: MatchRecord, actionCount = record.currentAction): GameState {
  if (record.version !== 1) throw new ReplayError('Versión de repetición incompatible.');
  assertValidMatchConfig(record.config);
  if (!Number.isInteger(actionCount) || actionCount < 0 || actionCount > record.actions.length)
    throw new ReplayError('Índice de repetición inválido.');
  let state = cloneState(record.initialState);
  const initialErrors = validateState(state, record.config);
  if (initialErrors.length) throw new ReplayError(initialErrors.join(' '));
  for (let index = 0; index < actionCount; index += 1) {
    const result = applyAction(state, record.actions[index]);
    if (!result.ok)
      throw new ReplayError(
        `Acción ilegal en el paso ${index + 1}: ${result.error ?? 'rechazada'}`,
      );
    state = result.state;
  }
  return state;
}

export function setReplayCursor(record: MatchRecord, currentAction: number): MatchRecord {
  replayRecord(record, currentAction);
  return { ...record, currentAction };
}

export function serializeRecord(record: MatchRecord): string {
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
  if (candidate.version !== 1) throw new ReplayError('Versión de guardado incompatible.');
  if (!Array.isArray(candidate.actions))
    throw new ReplayError('El diario de acciones no es válido.');
  replayRecord(candidate);
  return candidate;
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
    const actor = state.pieces.find((piece) => piece.id === action.pieceId);
    const result = applyAction(state, action);
    if (!result.ok || !actor) break;
    collectEvents(stats, actor.owner, result.events);
    state = result.state;
  }
  return stats;
}

function collectEvents(stats: MatchStatistics, owner: 0 | 1, events: GameEvent[]): void {
  for (const event of events) {
    if (event.type === 'destroy' && event.owner !== owner) stats.captures[owner] += 1;
    if (event.type === 'fortressDamage' && event.owner !== owner)
      stats.fortressDamage[owner] += event.amount ?? 1;
    if (event.type === 'transform') stats.transformations[owner] += 1;
  }
}
