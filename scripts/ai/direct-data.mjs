import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalJson,
  digest,
  parseResearchInput,
  selectPositionIndices,
} from './research-data.mjs';
import {
  loadGameModules,
  outcomeForPerspective,
  parseArguments,
  readModelBytes,
  seededRandom,
  validateSparseFeatures,
} from './shared.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sources = [
  'scripts/ai/direct-data.mjs',
  'scripts/ai/research-data.mjs',
  'scripts/ai/shared.mjs',
  'src/ai-neural.ts',
  'src/ai-neural-baseline.ts',
  'src/ai.ts',
  'src/ai-ranged.ts',
  'src/ai-material.ts',
  'src/ai-position.ts',
  'src/ai-airplane.ts',
  'src/engine.ts',
  'src/classic-rules.ts',
  'src/hex.ts',
  'src/types.ts',
  'src/action-identity.ts',
];

function bounded(value) {
  if (!Number.isFinite(value)) throw new Error('Valor no finito del modelo objetivo.');
  return Math.max(-1, Math.min(1, value));
}

export function developmentGames(text) {
  const header = JSON.parse(text.trim().split(/\r?\n/)[0]);
  if (header?.sourceRole !== 'development')
    throw new Error(
      'La entrada debe declarar sourceRole: development; no se usan datos reservados.',
    );
  return parseResearchInput(text);
}

/** Fixed-player, offline TD(lambda). A truncated trajectory bootstraps its last value. */
export function temporalTargets(values, outcome, gamma, lambda) {
  if (
    !Array.isArray(values) ||
    values.length < 2 ||
    values.some((value) => !Number.isFinite(value) || Math.abs(value) > 1) ||
    (outcome !== null && ![-1, 0, 1].includes(outcome)) ||
    !Number.isFinite(gamma) ||
    gamma <= 0 ||
    gamma > 1 ||
    !Number.isFinite(lambda) ||
    lambda < 0 ||
    lambda > 1
  )
    throw new Error('Contrato TD inválido.');
  const targets = new Array(values.length - 1);
  let nextReturn = outcome ?? values.at(-1);
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const nextValue = index === targets.length - 1 ? nextReturn : values[index + 1];
    nextReturn = gamma * ((1 - lambda) * nextValue + lambda * nextReturn);
    targets[index] = nextReturn;
  }
  return targets;
}

/** Labels are derived only after replaying the entire legal trajectory. */
export function directRows(games, modules, evaluate, settings) {
  if (!['distill', 'td'].includes(settings.mode)) throw new Error('Modo directo desconocido.');
  const target = settings.target ?? 'direct-value-v1';
  if (!['direct-value-v1', 'material-residual-v1'].includes(target))
    throw new Error('Objetivo neuronal desconocido.');
  const materialResidual = target === 'material-residual-v1';
  const scale = settings.residualScale ?? 2000;
  if (
    materialResidual &&
    (settings.mode !== 'distill' || !Number.isFinite(scale) || scale <= 0 || scale > 5000)
  )
    throw new Error('El residuo material requiere destilación y una escala entre 0 y 5000.');
  if (!Number.isFinite(settings.tdWeight) || settings.tdWeight < 0 || settings.tdWeight > 1)
    throw new Error('Peso TD inválido.');
  const successors = settings.successorsPerPosition ?? 0;
  if (!Number.isSafeInteger(successors) || successors < 0 || successors > 64)
    throw new Error('Número de sucesores inválido.');
  if (successors && settings.mode !== 'distill')
    throw new Error('Las ramas sin trayectoria posterior solo admiten destilación, no TD.');
  const { engine, neural, ranged } = modules;
  const rows = [];
  const counts = {
    games: 0,
    families: new Set(),
    completed: 0,
    truncated: 0,
    positions: 0,
    expandedPositions: 0,
    ...(materialResidual ? { clippedResidualPositions: 0 } : {}),
  };
  const labelsFor = (state, value, sign) => {
    if (!materialResidual) return { teacher: sign * value };
    const baseline = neural.evaluateNeuralMaterialBaseline(state, 0);
    const residual = (value * 10000 - baseline) / scale;
    if (sign === 1 && Math.abs(residual) >= 1) counts.clippedResidualPositions += 1;
    return {
      teacher: sign * bounded(residual),
      teacherScore: sign * value * 10000,
      baseline: sign * baseline,
    };
  };
  const fullValue = (state, rules) => {
    if (state.outcome) return outcomeForPerspective(state.outcome, 0);
    // Match the search evaluator exactly once, including its ranged supplement.
    const total =
      evaluate(state, 0, rules) +
      (evaluate.includesRangedValue ? 0 : ranged.evaluateRangedState(state, 0));
    if (!Number.isFinite(total)) throw new Error('Valor no finito del modelo objetivo.');
    return materialResidual ? total / 10000 : bounded(total / 10000);
  };
  const identities = new Map();
  const originalIdentities = new Set(games.map((game) => game.identity));
  const expandedIdentities = new Set();
  for (const game of games) {
    if (identities.has(game.identity)) {
      if (identities.get(game.identity) !== game.familyId)
        throw new Error(`Familias contradictorias para la misma trayectoria: ${game.gameId}.`);
      continue;
    }
    identities.set(game.identity, game.familyId);
    if (engine.validateState(game.initialState).length || game.initialState.outcome)
      throw new Error(`Estado inicial inválido o ya terminal: ${game.gameId}.`);
    const states = [engine.cloneState(game.initialState)];
    for (const [index, action] of game.actions.entries()) {
      if (states.at(-1).outcome) throw new Error(`Acción después del final: ${game.gameId}.`);
      const next = engine.applyAction(states.at(-1), action, game.rules);
      if (!next.ok) throw new Error(`Replay ilegal: ${game.gameId}, orden ${index + 1}.`);
      states.push(next.state);
    }
    if (states.length === 1) continue;
    const outcome = states.at(-1).outcome ?? null;
    const values = states.map((state) => fullValue(state, game.rules));
    const targets =
      settings.mode === 'td'
        ? temporalTargets(
            values,
            outcomeForPerspective(outcome, 0),
            settings.gamma,
            settings.lambda,
          )
        : values.slice(0, -1);
    const indices = selectPositionIndices(
      states.length - 1,
      settings.positionsPerGame,
      settings.minimumGap,
      (settings.seed ^ Number.parseInt(game.identity.slice(0, 8), 16)) >>> 0,
    );
    rows.push({
      kind: 'game',
      ...game,
      knownOutcome: outcome,
      termination: outcome ? 'engine-outcome' : 'truncated-with-value-bootstrap',
    });
    for (const index of indices) {
      const teacher =
        settings.mode === 'td'
          ? settings.tdWeight * targets[index] + (1 - settings.tdWeight) * values[index]
          : targets[index];
      for (const perspective of [0, 1]) {
        const sign = perspective === 0 ? 1 : -1;
        const features = neural.encodeNeuralFeatures(
          states[index],
          perspective,
          game.rules,
          neural.NEURAL_FEATURE_SCHEMA_V2,
        );
        validateSparseFeatures(features, neural.NEURAL_INPUT_SIZE_V2);
        rows.push({
          kind: 'sample',
          gameId: game.gameId,
          familyId: game.familyId,
          ply: states[index].ply,
          perspective,
          rules: game.rules,
          features,
          ...labelsFor(states[index], teacher, sign),
          outcome: outcomeForPerspective(outcome, perspective),
          frozenValue: sign * values[index],
          temporalTarget: settings.mode === 'td' ? sign * targets[index] : null,
          targetOrigin:
            settings.mode === 'td' ? 'offline-td-lambda' : 'full-evaluator-distillation',
        });
      }
      if (successors) {
        const random = seededRandom(
          (settings.seed ^ index ^ Number.parseInt(game.identity.slice(0, 8), 16)) >>> 0,
        );
        // Stratify syntactic action kinds; all legality and consequences come from the engine.
        const groups = [[], [], []];
        const shuffled = engine
          .getAllLegalActions(states[index])
          .map((action) => ({ action, key: random() }))
          .sort((a, b) => a.key - b.key);
        for (const { action } of shuffled)
          groups['targetId' in action ? 0 : action.kind === 'move' ? 1 : 2].push(action);
        for (let branch = 0; branch < successors; branch += 1) {
          const preferred = groups[[0, 0, 1, 2][branch % 4]];
          const action = (
            preferred.length ? preferred : groups.find((group) => group.length)
          )?.shift();
          if (!action) break;
          const next = engine.applyAction(states[index], action, game.rules);
          if (!next.ok) throw new Error('El motor rechazó un sucesor legal.');
          // Terminal values are exact runtime rules, not something the network must approximate.
          if (next.state.outcome) continue;
          const actions = [...game.actions.slice(0, index), action];
          const identity = digest(
            JSON.stringify({ initialState: game.initialState, actions, rules: game.rules }),
          );
          if (originalIdentities.has(identity) || expandedIdentities.has(identity)) continue;
          expandedIdentities.add(identity);
          const gameId = `replay-${identity.slice(0, 32)}`;
          const value = fullValue(next.state, game.rules);
          rows.push({
            kind: 'game',
            gameId,
            familyId: game.familyId,
            identity,
            initialState: game.initialState,
            actions,
            rules: game.rules,
            knownOutcome: null,
            termination: 'counterfactual-prefix-with-unknown-outcome',
            branchOrigin: { gameId: game.gameId, ply: states[index].ply },
          });
          for (const perspective of [0, 1]) {
            const sign = perspective === 0 ? 1 : -1;
            const features = neural.encodeNeuralFeatures(
              next.state,
              perspective,
              game.rules,
              neural.NEURAL_FEATURE_SCHEMA_V2,
            );
            validateSparseFeatures(features, neural.NEURAL_INPUT_SIZE_V2);
            rows.push({
              kind: 'sample',
              gameId,
              familyId: game.familyId,
              ply: next.state.ply,
              perspective,
              rules: game.rules,
              features,
              ...labelsFor(next.state, value, sign),
              outcome: null,
              frozenValue: sign * value,
              temporalTarget: null,
              targetOrigin: 'full-evaluator-distillation-legal-successor',
            });
          }
          counts.expandedPositions += 1;
          counts.positions += 1;
        }
      }
    }
    counts.games += 1;
    counts.families.add(game.familyId);
    counts.positions += indices.length;
    counts[outcome ? 'completed' : 'truncated'] += 1;
  }
  if (!counts.positions) throw new Error('No hay posiciones para entrenar.');
  return { rows, counts: { ...counts, families: counts.families.size } };
}

const hashes = async () =>
  Object.fromEntries(
    await Promise.all(
      sources.map(async (path) => [path, digest(await readFile(resolve(root, path)))]),
    ),
  );

export async function runDirectData(options) {
  const paths = options.input.split(',').map((path) => resolve(path));
  const modelPath = resolve(options.model);
  const output = resolve(options.output);
  const comparable = (path) => (process.platform === 'win32' ? path.toLowerCase() : path);
  if (new Set([...paths, modelPath, output].map(comparable)).size !== paths.length + 2)
    throw new Error('Entradas, modelo y salida deben ser rutas distintas.');
  const originals = await Promise.all([...paths, modelPath].map((path) => readFile(path)));
  const games = originals.slice(0, -1).flatMap((bytes) => developmentGames(bytes.toString('utf8')));
  const before = await hashes();
  const modules = await loadGameModules();
  try {
    const evaluate = modules.neural.createNeuralEvaluator(await readModelBytes(modelPath));
    const settings = {
      mode: options.mode,
      target: options.target ?? 'direct-value-v1',
      residualScale: options['residual-scale'] ?? 2000,
      gamma: options.gamma,
      lambda: options.lambda,
      tdWeight: options['td-weight'],
      positionsPerGame: options['positions-per-game'],
      minimumGap: options['min-gap'],
      seed: options.seed,
      successorsPerPosition: options['successors-per-position'],
    };
    const { rows, counts } = directRows(games, modules, evaluate, settings);
    const after = await hashes();
    const current = await Promise.all([...paths, modelPath].map((path) => readFile(path)));
    if (
      canonicalJson(before) !== canonicalJson(after) ||
      originals.some((bytes, index) => digest(bytes) !== digest(current[index]))
    )
      throw new Error('Fuentes, modelo o entradas cambiaron durante la preparación.');
    const header = {
      kind: 'metadata',
      format: 'hexagonal-neural-dataset',
      version: 1,
      schema: modules.neural.NEURAL_FEATURE_SCHEMA_V2,
      inputSize: modules.neural.NEURAL_INPUT_SIZE_V2,
      teacherScale: 10000,
      target: settings.target,
      ...(settings.target === 'material-residual-v1'
        ? {
            residualScale: settings.residualScale,
            residualBaseline: modules.neural.NEURAL_MATERIAL_BASELINE,
          }
        : {}),
      includesRangedValue: true,
      labelVersion: 'replayed-direct-value-v1',
      settings,
      counts,
      sourceRole: 'development',
      sources: paths.map((path, index) => ({ path, sha256: digest(originals[index]) })),
      model: { path: modelPath, sha256: digest(originals.at(-1)) },
      sourceHashes: before,
      normalization:
        settings.target === 'material-residual-v1'
          ? 'clip((full unbounded teacher score - versioned material baseline) / residualScale, -1, 1); no prior clipping of the total value'
          : 'clip(total-score / 10000, -1, 1); engine terminal values +/-1 or 0',
      truncation: 'Unknown outcome; TD bootstraps last frozen model value. Never an invented draw.',
      splitGrouping: 'familyId; consumers must preserve this grouping before splitting',
      successorSampling:
        'Seeded action-kind strata (target, target, move, other). Engine resolves every branch; terminal branches omitted. Exact replay identities already present or previously expanded are skipped. A branch keeps its source family and has no known outcome.',
      createdAt: new Date().toISOString(),
    };
    await mkdir(dirname(output), { recursive: true });
    const handle = await open(output, 'wx');
    try {
      await handle.writeFile([header, ...rows].map((row) => JSON.stringify(row)).join('\n') + '\n');
    } finally {
      await handle.close();
    }
    return { output, ...counts };
  } finally {
    await modules.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2), {
    input: { type: 'string', required: true },
    model: { type: 'string', required: true },
    output: { type: 'string', required: true },
    mode: { type: 'string', default: 'distill' },
    target: { type: 'string', default: 'direct-value-v1' },
    'residual-scale': { type: 'number', default: 2000, min: 0.000001, max: 5000 },
    gamma: { type: 'number', default: 0.99, min: 0.000001, max: 1 },
    lambda: { type: 'number', default: 0.7, min: 0, max: 1 },
    'td-weight': { type: 'number', default: 0.75, min: 0, max: 1 },
    'positions-per-game': { type: 'number', default: 128, integer: true, min: 1 },
    'min-gap': { type: 'number', default: 2, integer: true, min: 1 },
    'successors-per-position': { type: 'number', default: 0, integer: true, min: 0, max: 64 },
    seed: { type: 'number', default: 20261024, integer: true, min: 0, max: 4294967295 },
    help: { type: 'boolean', default: false },
  });
  if (options.help) {
    console.log(
      'pnpm exec node scripts/ai/direct-data.mjs --input trajectories.jsonl[,more.jsonl] --model target.bin --output data.jsonl [--mode distill|td --gamma .99 --lambda .7 --td-weight .75] [--target material-residual-v1 --residual-scale 2000] [--successors-per-position 4]\nReproduce todas las acciones, conserva familias y resultados reales; no sobrescribe salidas. Los sucesores legales adicionales y el residuo material solo admiten destilación. Las ramas no heredan el resultado de la trayectoria original.',
    );
    return;
  }
  console.log(JSON.stringify(await runDirectData(options)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
