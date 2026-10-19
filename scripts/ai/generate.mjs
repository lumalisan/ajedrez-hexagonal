import { mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  TEACHER_SCALE,
  addSearchMetrics,
  applySearchAction,
  commonArguments,
  createOpening,
  deriveSeed,
  describeSearchMetrics,
  loadGameModules,
  newSearchMetrics,
  normalizedTeacher,
  outcomeForPerspective,
  parseArguments,
  seededRandom,
  validateSparseFeatures,
} from './shared.mjs';

async function main() {
  const options = parseArguments(process.argv.slice(2), {
    ...commonArguments,
    games: { type: 'number', default: 12, integer: true, min: 1, max: 100_000 },
    'budget-ms': { ...commonArguments['budget-ms'], default: 250 },
    depth: { ...commonArguments.depth, default: 3 },
    'max-plies': { ...commonArguments['max-plies'], default: 120 },
    'sample-every': { type: 'number', default: 2, integer: true, min: 1, max: 2_000 },
    exploration: { type: 'number', default: 0.12, min: 0, max: 1 },
    output: { type: 'string', default: '.ai-lab/positions.jsonl' },
    overwrite: { type: 'boolean', default: false },
  });
  if (options.help) {
    console.log(`Genera posiciones de autojuego etiquetadas por Experto (balanced).
  pnpm ai:generate --games 12 --budget-ms 250 --depth 3 --max-plies 120
    --seed 1 --sample-every 2 --opening-plies 4 --exploration 0.12
    --output .ai-lab/positions.jsonl [--overwrite]
Presupuesto mínimo: 20 ms. Exploración: probabilidad de jugar una acción legal aleatoria.
Las partidas truncadas conservan outcome:null; se separan por gameId al entrenar.
La semilla reproduce aperturas y variedad. Un corte por tiempo puede cambiar la profundidad.`);
    return;
  }
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  const file = await open(output, options.overwrite ? 'w' : 'wx');
  let modules;
  try {
    modules = await loadGameModules();
    const rules = { ...modules.engine.DEFAULT_ACTION_RESOLUTION_RULES };
    const metadata = {
      kind: 'metadata',
      format: 'hexagonal-neural-dataset',
      version: 1,
      schema: modules.neural.NEURAL_FEATURE_SCHEMA,
      inputSize: modules.neural.NEURAL_INPUT_SIZE,
      featureEncoding: 'sparse-binary-indices',
      teacherScale: TEACHER_SCALE,
      createdAt: new Date().toISOString(),
      teacher: { difficulty: 'expert', personality: 'balanced', normalized: 'tanh(score/10000)' },
      settings: options,
      rules,
      layouts: [3, 5],
      fortressHp: options['fortress-hp'] ? [options['fortress-hp']] : [1, 2, 3],
      perspective: 'Each sample has its own fixed player perspective, recorded as perspective.',
      unfinishedOutcome: null,
      reproducibility:
        'Opening and exploration are seeded; time-limited search depth depends on hardware and load.',
    };
    await file.write(`${JSON.stringify(metadata)}\n`);
    let sampleCount = 0;
    let inconclusive = 0;
    for (let index = 0; index < options.games; index += 1) {
      const opening = createOpening(modules, {
        seed: options.seed,
        index,
        openingPlies: options['opening-plies'],
        fortressHp: options['fortress-hp'],
      });
      const gameId = `selfplay-${options.seed}-${index}`;
      const random = seededRandom(deriveSeed(opening.seed, 0));
      const samples = [];
      const actions = [...opening.actions];
      const metrics = newSearchMetrics();
      let state = opening.state;
      let skippedLabels = 0;
      const firstPly = state.ply;
      while (!state.outcome && state.ply - firstPly < options['max-plies']) {
        const search = modules.ai.searchMachineActionWithMetadata(state, {
          depth: options.depth,
          budgetMs: options['budget-ms'],
          difficulty: 'expert',
          personality: 'balanced',
          seed: deriveSeed(opening.seed, state.ply),
          resolutionRules: rules,
        });
        addSearchMetrics(metrics, search.metadata);
        if ((state.ply - firstPly) % options['sample-every'] === 0) {
          if (search.metadata.completedDepth > 0 && Number.isFinite(search.metadata.score)) {
            for (const perspective of [0, 1]) {
              const features = modules.neural.encodeNeuralFeatures(state, perspective, rules);
              validateSparseFeatures(features, metadata.inputSize);
              const score =
                perspective === state.activePlayer ? search.metadata.score : -search.metadata.score;
              samples.push({
                kind: 'sample',
                gameId,
                features,
                teacher: normalizedTeacher(score),
                perspective,
                ply: state.ply,
                completedDepth: search.metadata.completedDepth,
                teacherScore: score,
              });
            }
          } else {
            skippedLabels += 1;
          }
        }
        let action = search.action;
        if (action && random() < options.exploration) {
          const legal = modules.engine.getAllLegalActions(state);
          action = legal[Math.floor(random() * legal.length)];
        }
        const next = applySearchAction(modules, state, action, rules);
        if (action) actions.push(action);
        state = next;
      }
      for (const sample of samples) {
        await file.write(
          `${JSON.stringify({
            ...sample,
            outcome: outcomeForPerspective(state.outcome, sample.perspective),
          })}\n`,
        );
      }
      await file.write(
        `${JSON.stringify({
          kind: 'game',
          gameId,
          seed: opening.seed,
          initialLayout: opening.initialLayout,
          fortressHp: opening.fortressHp,
          initialState: opening.initialState,
          openingPlies: opening.actions.length,
          actions,
          outcome: state.outcome,
          termination: state.outcome ? 'engine-outcome' : 'max-plies',
          finalPly: state.ply,
          samples: samples.length,
          skippedLabels,
          metrics: describeSearchMetrics(metrics),
        })}\n`,
      );
      await file.sync();
      sampleCount += samples.length;
      inconclusive += Number(state.outcome === null);
      console.log(
        `${gameId}: ${state.ply} plies; ${samples.length} muestras; ${skippedLabels} sin profundidad completa; ` +
          `${state.outcome ? JSON.stringify(state.outcome) : 'inconclusa (límite de jugadas)'}.`,
      );
    }
    console.log(
      `${sampleCount} muestras de ${options.games} partidas (${inconclusive} inconclusas). Archivo: ${output}`,
    );
  } finally {
    await file.close();
    await modules?.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
