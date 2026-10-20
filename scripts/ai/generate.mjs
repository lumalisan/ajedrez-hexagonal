import { mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { trainingTarget } from './selfplay-policy.mjs';

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
  readModelBytes,
  seededRandom,
  validateSparseFeatures,
} from './shared.mjs';

async function main() {
  const options = parseArguments(process.argv.slice(2), {
    ...commonArguments,
    games: { type: 'number', default: 12, integer: true, min: 1, max: 100_000 },
    'game-offset': { type: 'number', default: 0, integer: true, min: 0, max: 1_000_000_000 },
    'budget-ms': { ...commonArguments['budget-ms'], default: 250 },
    depth: { ...commonArguments.depth, default: 3 },
    'max-plies': { ...commonArguments['max-plies'], default: 120 },
    'sample-every': { type: 'number', default: 2, integer: true, min: 1, max: 2_000 },
    exploration: { type: 'number', default: 0.12, min: 0, max: 1 },
    output: { type: 'string', default: '.ai-lab/positions.jsonl' },
    overwrite: { type: 'boolean', default: false },
    model: { type: 'string' },
    'opponent-model': { type: 'string' },
    residual: { type: 'boolean', default: false },
    'outcome-weight': { type: 'number', default: 0, min: 0, max: 1 },
    'outcome-decay': { type: 'number', default: 0.98, min: 0, max: 1 },
  });
  if (options.help) {
    console.log(`Genera posiciones de autojuego etiquetadas por Experto (balanced).
  pnpm ai:generate --games 12 --budget-ms 250 --depth 3 --max-plies 120
    --seed 1 --sample-every 2 --opening-plies 4 --exploration 0.12
    --output .ai-lab/positions.jsonl [--overwrite]
Presupuesto mínimo: 20 ms. Exploración: probabilidad de jugar una acción legal aleatoria.
Las partidas truncadas conservan outcome:null; se separan por gameId al entrenar.
--model ruta juega con la red; alterna autojuego y partidas contra Experto.
--opponent-model ruta añade un rival histórico. --residual exporta correcciones clásicas.
En modo residual, --outcome-weight 0.25 añade hasta 500 puntos por resultado real,
descontados por --outcome-decay 0.98 por orden hasta el final.
La semilla reproduce aperturas y variedad. Un corte por tiempo puede cambiar la profundidad.`);
    return;
  }
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  const file = await open(output, options.overwrite ? 'w' : 'wx');
  let modules;
  try {
    modules = await loadGameModules();
    if (options['opponent-model'] && !options.model) {
      throw new Error('--opponent-model requiere --model.');
    }
    const evaluate = options.model
      ? modules.neural.createNeuralEvaluator(await readModelBytes(options.model))
      : undefined;
    const opponent = options['opponent-model']
      ? modules.neural.createNeuralEvaluator(await readModelBytes(options['opponent-model']))
      : undefined;
    const rules = { ...modules.engine.DEFAULT_ACTION_RESOLUTION_RULES };
    const metadata = {
      kind: 'metadata',
      format: 'hexagonal-neural-dataset',
      version: 1,
      schema: modules.neural.NEURAL_FEATURE_SCHEMA,
      inputSize: modules.neural.NEURAL_INPUT_SIZE,
      featureEncoding: 'sparse-binary-indices',
      teacherScale: TEACHER_SCALE,
      ...(options.residual
        ? {
            target: 'classic-residual-v1',
            residualScale: 2000,
            residualBaseline: 'classic+ranged-v1',
            labelVersion: 'bounded-outcome-v2',
            evaluationVersion: 'strategic-v2',
          }
        : {}),
      createdAt: new Date().toISOString(),
      teacher: {
        difficulty: 'expert',
        personality: 'balanced',
        normalized: 'tanh(score/10000)',
        model: options.model ?? null,
        opponents: evaluate
          ? ['self', 'classic', ...(opponent ? ['historical'] : [])]
          : ['classic'],
      },
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
      const gameIndex = index + options['game-offset'];
      const opening = createOpening(modules, {
        seed: options.seed,
        index: gameIndex,
        openingPlies: options['opening-plies'],
        fortressHp: options['fortress-hp'],
      });
      const gameId = `selfplay-${options.seed}-${gameIndex}`;
      const random = seededRandom(deriveSeed(opening.seed, 0));
      const samples = [];
      const actions = [...opening.actions];
      const metrics = newSearchMetrics();
      let state = opening.state;
      let skippedLabels = 0;
      const firstPly = state.ply;
      const matchup = gameIndex % (opponent ? 3 : 2);
      const modelPlayer = Math.floor(gameIndex / (opponent ? 3 : 2)) % 2;
      while (!state.outcome && state.ply - firstPly < options['max-plies']) {
        const evaluator = !evaluate
          ? undefined
          : matchup === 0 || state.activePlayer === modelPlayer
            ? evaluate
            : matchup === 2
              ? opponent
              : undefined;
        const search = modules.ai.searchMachineActionWithMetadata(state, {
          depth: options.depth,
          budgetMs: options['budget-ms'],
          difficulty: 'expert',
          personality: 'balanced',
          seed: deriveSeed(opening.seed, state.ply),
          resolutionRules: rules,
          ...(evaluator ? { evaluate: evaluator } : {}),
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
                baseline:
                  modules.ai.evaluateClassicState(state, perspective) +
                  (options.residual ? modules.ranged.evaluateRangedState(state, perspective) : 0),
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
        const outcome = outcomeForPerspective(state.outcome, sample.perspective);
        const teacher = trainingTarget({
          teacher: sample.teacher,
          teacherScore: sample.teacherScore,
          baseline: sample.baseline,
          outcome,
          outcomeWeight: options['outcome-weight'],
          residual: options.residual,
          remainingPlies: state.ply - sample.ply,
          outcomeDecay: options['outcome-decay'],
        });
        await file.write(
          `${JSON.stringify({
            ...sample,
            teacher,
            outcome,
          })}\n`,
        );
      }
      await file.write(
        `${JSON.stringify({
          kind: 'game',
          gameId,
          matchup: !evaluate
            ? 'classic'
            : matchup === 0
              ? 'self'
              : matchup === 2
                ? 'historical'
                : 'classic',
          modelPlayer,
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
