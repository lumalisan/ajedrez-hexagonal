import { readFile, mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  loadGameModules,
  parseArguments,
  seededRandom,
  deriveSeed,
  validateSparseFeatures,
} from './shared.mjs';

const options = parseArguments(process.argv.slice(2), {
  input: { type: 'string', default: '.ai-lab/pilot-positions-v2.jsonl' },
  arena: { type: 'string', default: '.ai-lab/arena-expert15s.json' },
  output: { type: 'string', default: '.ai-lab/residual-positions.jsonl' },
  positions: { type: 'number', integer: true, min: 16, default: 768 },
  'budget-ms': { type: 'number', integer: true, min: 100, default: 1000 },
  depth: { type: 'number', integer: true, min: 1, max: 12, default: 5 },
  seed: { type: 'number', integer: true, min: 0, default: 280319 },
  'residual-scale': { type: 'number', min: 100, max: 5000, default: 2000 },
});
const modules = await loadGameModules();
let output;
try {
  const rows = (await readFile(options.input, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  const arena = JSON.parse(await readFile(options.arena, 'utf8'));
  const games = [
    ...rows.filter((row) => row.kind === 'game'),
    ...arena.games.map((game) => ({ ...game, gameId: `failure-${game.gameId}` })),
  ];
  const rules = { ...modules.engine.DEFAULT_ACTION_RESOLUTION_RULES };
  const candidates = [];
  for (const game of games) {
    let state = modules.engine.cloneState(game.initialState);
    for (let index = 0; index < game.actions.length; index += 1) {
      if (!state.outcome && index >= 6 && index % 3 === 0) {
        candidates.push({
          gameId: game.gameId,
          state,
          failure: game.gameId.startsWith('failure-'),
        });
      }
      const resolved = modules.engine.applyAction(state, game.actions[index], rules);
      if (!resolved.ok) throw new Error(`Replay ilegal: ${game.gameId}, paso ${index}`);
      state = resolved.state;
    }
  }
  const random = seededRandom(options.seed);
  const shuffled = candidates
    .map((entry) => ({ ...entry, random: random() }))
    .sort((a, b) => Number(b.failure) - Number(a.failure) || a.random - b.random)
    .slice(0, options.positions);
  const path = resolve(options.output);
  await mkdir(dirname(path), { recursive: true });
  output = await open(path, 'wx');
  await output.write(
    `${JSON.stringify({
      kind: 'metadata',
      format: 'hexagonal-neural-dataset',
      version: 1,
      schema: modules.neural.NEURAL_FEATURE_SCHEMA,
      inputSize: modules.neural.NEURAL_INPUT_SIZE,
      teacherScale: 10000,
      featureEncoding: 'sparse-binary-indices',
      target: 'classic-residual-v1',
      residualScale: options['residual-scale'],
      settings: options,
      rules,
      trainingArenaSeed: arena.settings.seed,
    })}\n`,
  );
  let accepted = 0;
  let skipped = 0;
  for (const [index, entry] of shuffled.entries()) {
    const { state } = entry;
    const search = modules.ai.searchMachineActionWithMetadata(state, {
      depth: options.depth,
      budgetMs: options['budget-ms'],
      difficulty: 'expert',
      personality: 'balanced',
      seed: deriveSeed(options.seed, index),
      resolutionRules: rules,
    });
    if (search.metadata.completedDepth === 0 || !Number.isFinite(search.metadata.score)) {
      skipped += 1;
      continue;
    }
    for (const perspective of [0, 1]) {
      const score = search.metadata.score * (perspective === state.activePlayer ? 1 : -1);
      const baseline = modules.ai.evaluateClassicState(state, perspective);
      const features = modules.neural.encodeNeuralFeatures(state, perspective, rules);
      validateSparseFeatures(features, modules.neural.NEURAL_INPUT_SIZE);
      await output.write(
        `${JSON.stringify({
          kind: 'sample',
          gameId: entry.gameId,
          features,
          teacher: Math.max(-1, Math.min(1, (score - baseline) / options['residual-scale'])),
          outcome: null,
          perspective,
          ply: state.ply,
          baseline,
          teacherScore: score,
          completedDepth: search.metadata.completedDepth,
        })}\n`,
      );
    }
    accepted += 1;
    if (accepted % 32 === 0) {
      await output.sync();
      console.log(
        `${accepted}/${shuffled.length} posiciones, ${skipped} descartadas; profundidad última ${search.metadata.completedDepth}.`,
      );
    }
  }
  console.log(`${accepted * 2} muestras residuales, ${skipped} posiciones descartadas. ${path}`);
} finally {
  await output?.close();
  await modules.close();
}
