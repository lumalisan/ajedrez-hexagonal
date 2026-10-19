import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPERT_BUDGET_MS = 15_000;
export const EXPERT_DEPTH = 9;
export const TEACHER_SCALE = 10_000;

/** Strict CLI parsing keeps accidental NaN, zero budgets and misspelled flags out of reports. */
export function parseArguments(argv, definitions) {
  const parsed = Object.fromEntries(
    Object.entries(definitions)
      .filter(([, definition]) => definition.default !== undefined)
      .map(([name, definition]) => [name, definition.default]),
  );
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Argumento inesperado: ${token}`);
    const equals = token.indexOf('=');
    const name = token.slice(2, equals < 0 ? undefined : equals);
    const definition = definitions[name];
    if (!definition) throw new Error(`Opción desconocida: --${name}`);
    if (seen.has(name)) throw new Error(`Opción repetida: --${name}`);
    seen.add(name);
    if (definition.type === 'boolean') {
      if (equals >= 0) throw new Error(`--${name} no acepta un valor.`);
      parsed[name] = true;
      continue;
    }
    const raw = equals >= 0 ? token.slice(equals + 1) : argv[++index];
    if (!raw || raw.startsWith('--')) throw new Error(`Falta un valor para --${name}.`);
    if (definition.type === 'number') {
      const value = Number(raw);
      if (
        !Number.isFinite(value) ||
        (definition.integer && !Number.isSafeInteger(value)) ||
        (definition.min !== undefined && value < definition.min) ||
        (definition.max !== undefined && value > definition.max)
      ) {
        throw new Error(`Valor inválido para --${name}: ${raw}`);
      }
      parsed[name] = value;
    } else {
      parsed[name] = raw;
    }
  }
  if (!parsed.help) {
    for (const [name, definition] of Object.entries(definitions)) {
      if (definition.required && parsed[name] === undefined) {
        throw new Error(`La opción --${name} es obligatoria.`);
      }
    }
  }
  return parsed;
}

export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function deriveSeed(seed, index) {
  return (seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
}

export function normalizedTeacher(score) {
  if (!Number.isFinite(score)) throw new Error('La valoración del profesor debe ser finita.');
  return Math.tanh(score / TEACHER_SCALE);
}

export function validateSparseFeatures(features, inputSize) {
  if (
    !Array.isArray(features) ||
    !features.length ||
    !features.every(
      (feature) => Number.isInteger(feature) && feature >= 0 && feature < inputSize,
    ) ||
    new Set(features).size !== features.length
  ) {
    throw new Error('El codificador produjo índices dispersos incompatibles.');
  }
}

/** Null means unfinished; only the rules engine may label a game as a draw. */
export function outcomeForPerspective(outcome, perspective) {
  if (!outcome) return null;
  if (outcome.type === 'draw') return 0;
  return outcome.winner === perspective ? 1 : -1;
}

export function summarizeArena(games) {
  const result = { wins: 0, draws: 0, losses: 0, inconclusive: 0 };
  for (const game of games) {
    const value = outcomeForPerspective(game.outcome, game.neuralPlayer);
    if (value === null) result.inconclusive += 1;
    else if (value === 1) result.wins += 1;
    else if (value === -1) result.losses += 1;
    else result.draws += 1;
  }
  const completed = result.wins + result.draws + result.losses;
  const score = completed ? (result.wins + result.draws / 2) / completed : null;
  let scoreInterval95 = null;
  if (score !== null) {
    const z = 1.959963984540054;
    const denominator = 1 + (z * z) / completed;
    const midpoint = (score + (z * z) / (2 * completed)) / denominator;
    const radius =
      (z * Math.sqrt((score * (1 - score) + (z * z) / (4 * completed)) / completed)) / denominator;
    scoreInterval95 = [Math.max(0, midpoint - radius), Math.min(1, midpoint + radius)];
  }
  return {
    ...result,
    completed,
    score,
    scoreInterval95,
    intervalMethod:
      'Wilson aproximado: tablas cuentan 0,5; no corrige correlación entre partidas del mismo par.',
    interpretation:
      'Ensayo experimental. Los límites de jugadas producen partidas inconclusas; no prueban superioridad.',
  };
}

export function newSearchMetrics() {
  return {
    searches: 0,
    elapsedMs: 0,
    nodes: 0,
    depthSum: 0,
    maxDepth: 0,
    timedOut: 0,
    depthZero: 0,
  };
}

export function addSearchMetrics(metrics, metadata) {
  metrics.searches += 1;
  metrics.elapsedMs += metadata.elapsedMs;
  metrics.nodes += metadata.nodes;
  metrics.depthSum += metadata.completedDepth;
  metrics.maxDepth = Math.max(metrics.maxDepth, metadata.completedDepth);
  metrics.timedOut += Number(metadata.timedOut);
  metrics.depthZero += Number(metadata.completedDepth === 0);
}

export function describeSearchMetrics(metrics) {
  return {
    ...metrics,
    averageDepth: metrics.searches ? metrics.depthSum / metrics.searches : null,
    averageElapsedMs: metrics.searches ? metrics.elapsedMs / metrics.searches : null,
  };
}

export async function loadGameModules() {
  const { createServer } = await import('vite');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
  });
  try {
    const [ai, engine, setup, neural] = await Promise.all([
      server.ssrLoadModule('/src/ai.ts'),
      server.ssrLoadModule('/src/engine.ts'),
      server.ssrLoadModule('/src/setup.ts'),
      server.ssrLoadModule('/src/ai-neural.ts'),
    ]);
    return { ai, engine, setup, neural, close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
}

export async function writeJsonCheckpoint(path, value) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, absolute);
}

export async function readModelBytes(path) {
  const bytes = await readFile(resolve(path));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** All starting positions and random opening actions are retained for replay. */
export function createOpening(modules, { seed, index, openingPlies, fortressHp: requestedHp }) {
  const random = seededRandom(deriveSeed(seed, index));
  const initialLayout = index % 2 === 0 ? 3 : 5;
  const fortressHp = requestedHp ?? (Math.floor(index / 2) % 3) + 1;
  const initialState = modules.engine.createGameState(
    modules.setup.createInitialPieces(fortressHp, initialLayout),
  );
  let state = initialState;
  const actions = [];
  const rules = { ...modules.engine.DEFAULT_ACTION_RESOLUTION_RULES };
  for (let ply = 0; ply < openingPlies && !state.outcome; ply += 1) {
    const legal = modules.engine.getAllLegalActions(state);
    if (!legal.length) break;
    const action = legal[Math.floor(random() * legal.length)];
    const resolved = modules.engine.applyAction(state, action, rules);
    if (!resolved.ok) throw new Error('El motor rechazó una acción de apertura legal.');
    actions.push(action);
    state = resolved.state;
  }
  return { seed: deriveSeed(seed, index), initialLayout, fortressHp, initialState, actions, state };
}

export function applySearchAction(modules, state, action, rules) {
  if (!action) {
    if (modules.engine.getAllLegalActions(state).length) {
      throw new Error('La búsqueda devolvió null aunque existen acciones legales.');
    }
    const other = modules.engine.cloneState(state);
    other.activePlayer = state.activePlayer === 0 ? 1 : 0;
    if (modules.engine.getAllLegalActions(other).length) {
      throw new Error('Pase no resuelto por el motor: no se adjudica un empate artificial.');
    }
    const result = modules.engine.declareBlockade(state);
    if (!result.ok) throw new Error('El motor no pudo resolver el bloqueo.');
    return result.state;
  }
  const result = modules.engine.applyAction(state, action, rules);
  if (!result.ok) throw new Error('La búsqueda devolvió una acción ilegal.');
  return result.state;
}

export const commonArguments = {
  help: { type: 'boolean', default: false },
  'budget-ms': { type: 'number', default: EXPERT_BUDGET_MS, integer: true, min: 20, max: 120_000 },
  depth: { type: 'number', default: EXPERT_DEPTH, integer: true, min: 1, max: 12 },
  'max-plies': { type: 'number', default: 240, integer: true, min: 1, max: 2_000 },
  seed: { type: 'number', default: 1, integer: true, min: 0, max: 4_294_967_295 },
  'opening-plies': { type: 'number', default: 4, integer: true, min: 0, max: 40 },
  'fortress-hp': { type: 'number', integer: true, min: 1, max: 3 },
};
