import { createHash } from 'node:crypto';
import { seededRandom, validateSparseFeatures } from './shared.mjs';

export const digest = (value) => createHash('sha256').update(value).digest('hex');

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function normalizeRules(rules) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
    throw new Error('Cada partida necesita sus reglas explícitas.');
  }
  const result = {};
  for (const key of ['repetition', 'noProgressPlyLimit', 'orientationOnlyTurnLimit']) {
    const value = rules[key];
    if (value === undefined && key === 'orientationOnlyTurnLimit') continue;
    if (value !== null && (!Number.isSafeInteger(value) || value < 1)) {
      throw new Error(`Regla incompatible: ${key}.`);
    }
    result[key] = value;
  }
  return result;
}

/** Only explicitly supplied files are read. Arena outcomes/finalState are never labels. */
export function parseResearchInput(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('El archivo de entrada está vacío.');
  let document;
  try {
    document = JSON.parse(trimmed);
  } catch {
    document = null;
  }
  let games;
  let rules;
  let format;
  if (document?.format === 'hexagonal-neural-arena' && document.version === 1) {
    if (!Array.isArray(document.games)) throw new Error('Arena sin partidas.');
    games = [...document.games, ...(document.inProgress ? [document.inProgress] : [])];
    rules = document.rules;
    format = 'arena';
  } else {
    const rows = trimmed.split(/\r?\n/).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`JSONL inválido en la línea ${index + 1}.`);
      }
    });
    const header = rows[0];
    if (
      header?.kind !== 'metadata' ||
      header.format !== 'hexagonal-neural-dataset' ||
      header.version !== 1
    ) {
      throw new Error('Se requiere un dataset JSONL con partidas o un informe de arena v1.');
    }
    games = rows.filter((row) => row.kind === 'game');
    rules = header.rules;
    format = 'dataset';
  }
  if (!games.length) throw new Error('El archivo no contiene trayectorias de partidas.');
  const identities = new Set();
  return games.flatMap((game) => {
    if (!game.initialState || !Array.isArray(game.actions)) {
      throw new Error('Partida sin estado inicial o diario de acciones.');
    }
    const gameRules = normalizeRules(game.rules ?? rules);
    // Same identity and gameId as prepare-replays, independent of file names and labels.
    const identity = digest(
      JSON.stringify({ initialState: game.initialState, actions: game.actions, rules: gameRules }),
    );
    const gameId = `replay-${identity.slice(0, 32)}`;
    const familyId = game.familyId ?? game.sourceFamilyId ?? gameId;
    if (typeof familyId !== 'string' || !familyId) throw new Error('Linaje de partida inválido.');
    if (identities.has(identity)) return [];
    identities.add(identity);
    return [
      {
        gameId,
        familyId,
        identity,
        sourceGameId: game.gameId ?? null,
        sourceFormat: format,
        initialState: game.initialState,
        actions: game.actions,
        rules: gameRules,
      },
    ];
  });
}

/** Stratified seeded sampling avoids taking many adjacent states from one trajectory. */
export function selectPositionIndices(length, maximum, minimumGap, seed) {
  if (!length || !maximum) return [];
  const count = Math.min(maximum, Math.ceil(length / minimumGap));
  const random = seededRandom(seed);
  const selected = [];
  for (let bucket = 0; bucket < count; bucket += 1) {
    const first = Math.ceil((bucket * length) / count);
    const last = Math.ceil(((bucket + 1) * length) / count) - 1;
    const lower = Math.max(first, (selected.at(-1) ?? -minimumGap) + minimumGap);
    // Leave room for the remaining strata while respecting the actual spacing.
    const upper = Math.min(last, length - 1 - (count - bucket - 1) * minimumGap);
    if (lower <= upper) selected.push(lower + Math.floor(random() * (upper - lower + 1)));
  }
  return selected;
}

export function positionFingerprint(features, rules) {
  return digest(
    canonicalJson({
      features: features.map((indices) => [...indices].sort((left, right) => left - right)),
      rules,
    }),
  );
}

export function reconstructResearchGame(game, modules, selectedIndices) {
  const errors = modules.engine.validateState(game.initialState);
  if (errors.length)
    throw new Error(`Estado inicial inválido (${game.gameId}): ${errors.join('; ')}`);
  let state = modules.engine.cloneState(game.initialState);
  const positions = [];
  const selected = selectedIndices ? new Set(selectedIndices) : null;
  for (const [index, action] of game.actions.entries()) {
    if (state.outcome) throw new Error(`Acciones después del final: ${game.gameId}.`);
    if (selected === null || selected.has(index)) positions[index] = state;
    const result = modules.engine.applyAction(state, action, game.rules);
    if (!result.ok) throw new Error(`Replay ilegal: ${game.gameId}, orden ${index + 1}.`);
    state = result.state;
  }
  // A non-board conclusion injected in an initial state is not a training result.
  const outcome = state.outcome;
  const knownOutcome =
    outcome && !['resignation', 'timeout'].includes(outcome.reason) ? outcome : null;
  return {
    ...game,
    positions,
    selectedIndices: selectedIndices ?? positions.map((_, index) => index),
    knownOutcome,
    finalPly: state.ply,
  };
}

export function encodeResearchPosition(
  position,
  rules,
  modules,
  schema = modules.neural.NEURAL_FEATURE_SCHEMA,
) {
  const features = [0, 1].map((perspective) => {
    const encoded = modules.neural.encodeNeuralFeatures(position, perspective, rules, schema);
    validateSparseFeatures(
      encoded,
      schema === modules.neural.NEURAL_FEATURE_SCHEMA_V2
        ? modules.neural.NEURAL_INPUT_SIZE_V2
        : modules.neural.NEURAL_INPUT_SIZE,
    );
    return encoded;
  });
  return { features, fingerprint: positionFingerprint(features, rules) };
}
