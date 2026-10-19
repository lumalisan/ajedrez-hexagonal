import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import {
  EXPERT_BUDGET_MS,
  EXPERT_DEPTH,
  addSearchMetrics,
  applySearchAction,
  commonArguments,
  createOpening,
  deriveSeed,
  describeSearchMetrics,
  loadGameModules,
  newSearchMetrics,
  parseArguments,
  readModelBytes,
  summarizeArena,
  writeJsonCheckpoint,
} from './shared.mjs';

async function main() {
  const options = parseArguments(process.argv.slice(2), {
    ...commonArguments,
    model: { type: 'string', required: true },
    pairs: { type: 'number', default: 4, integer: true, min: 1, max: 10_000 },
    output: { type: 'string', default: '.ai-lab/arena.json' },
    'candidate-profile': { type: 'string', default: 'model' },
    ablation: { type: 'boolean', default: false },
  });
  if (options.help) {
    console.log(`Compara el candidato con Experto clásico balanced, con los mismos límites.
  pnpm ai:arena --model .ai-lab/model.bin --pairs 4 --budget-ms 15000 --depth 9
    --max-plies 240 --opening-plies 4 --seed 1 --output .ai-lab/arena.json
Cada par repite exactamente la apertura e intercambia los bandos.
El presupuesto actual de Experto es 15000 ms y profundidad máxima 9.
Un presupuesto reducido es un ensayo diferente. Las truncadas se cuentan como inconclusas.
--candidate-profile model|classic|pvs-history|pvs-threats controla el buscador del candidato.
--ablation conserva el perfil y sus heurísticas tácticas, pero omite la corrección neuronal.
El informe se guarda tras cada partida; los tiempos en Node no sustituyen medir el navegador.`);
    return;
  }
  const bytes = await readModelBytes(options.model);
  const modules = await loadGameModules();
  try {
    const evaluate = modules.neural.createNeuralEvaluator(bytes);
    const metadata = modules.neural.parseNeuralModel(bytes).metadata;
    const profile =
      options['candidate-profile'] === 'model'
        ? (evaluate.searchProfile ?? 'classic')
        : options['candidate-profile'];
    if (!['classic', 'pvs-history', 'pvs-threats'].includes(profile)) {
      throw new Error('--candidate-profile debe ser model, classic, pvs-history o pvs-threats.');
    }
    const rules = { ...modules.engine.DEFAULT_ACTION_RESOLUTION_RULES };
    const standardExpertCaps =
      options['budget-ms'] === EXPERT_BUDGET_MS && options.depth === EXPERT_DEPTH;
    const metrics = { classical: newSearchMetrics(), neural: newSearchMetrics() };
    const report = {
      format: 'hexagonal-neural-arena',
      version: 1,
      status: 'running',
      createdAt: new Date().toISOString(),
      settings: options,
      model: {
        path: resolve(options.model),
        sha256: createHash('sha256').update(new Uint8Array(bytes)).digest('hex'),
        schema: modules.neural.NEURAL_FEATURE_SCHEMA,
        inputSize: modules.neural.NEURAL_INPUT_SIZE,
        bytes: bytes.byteLength,
        evaluation: metadata.evaluation ?? 'standalone-v1',
        residualScale: metadata.residualScale ?? null,
        residualSymmetry: metadata.residualSymmetry ?? null,
      },
      candidate: {
        searchProfile: profile,
        evaluator: options.ablation ? 'classical-ablation' : 'neural',
        variety: profile === 'classic' ? 'expert-default' : 'best-score',
        rangedEvaluation: profile === 'pvs-threats' ? 'ranged-v1' : null,
      },
      referenceExpert: {
        difficulty: 'expert',
        personality: 'balanced',
        depth: 9,
        budgetMs: 15_000,
      },
      standardExpertCaps,
      budgetDescription: standardExpertCaps
        ? 'Presupuesto y profundidad máxima del Experto actual.'
        : `Ensayo con límites modificados: ${options['budget-ms']} ms, profundidad ${options.depth}. No equivale al Experto de 15 s/profundidad 9.`,
      environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      rules,
      pairing: 'Identical seeded opening and search seeds per pair; neural plays each side once.',
      games: [],
      summary: summarizeArena([]),
      metrics: {},
    };
    await writeJsonCheckpoint(options.output, report);
    console.log(report.budgetDescription);
    try {
      for (let pair = 0; pair < options.pairs; pair += 1) {
        const opening = createOpening(modules, {
          seed: options.seed,
          index: pair,
          openingPlies: options['opening-plies'],
          fortressHp: options['fortress-hp'],
        });
        for (const neuralPlayer of [0, 1]) {
          const gameId = `pair-${pair + 1}-neural-${neuralPlayer}`;
          let state = modules.engine.cloneState(opening.state);
          const firstPly = state.ply;
          const actions = [...opening.actions];
          const searches = [];
          const gameMetrics = { classical: newSearchMetrics(), neural: newSearchMetrics() };
          const startedAt = performance.now();
          console.log(
            `${gameId}: inicio; disposición ${opening.initialLayout}, HP ${opening.fortressHp}.`,
          );
          while (!state.outcome && state.ply - firstPly < options['max-plies']) {
            const player = state.activePlayer;
            const kind = player === neuralPlayer ? 'neural' : 'classical';
            const search = modules.ai.searchMachineActionWithMetadata(state, {
              depth: options.depth,
              budgetMs: options['budget-ms'],
              difficulty: 'expert',
              personality: 'balanced',
              seed: deriveSeed(opening.seed, state.ply),
              resolutionRules: rules,
              ...(kind === 'neural'
                ? {
                    evaluate: options.ablation
                      ? (position, player) => modules.ai.evaluateClassicState(position, player)
                      : evaluate,
                    searchProfile: profile,
                  }
                : {}),
            });
            addSearchMetrics(metrics[kind], search.metadata);
            addSearchMetrics(gameMetrics[kind], search.metadata);
            searches.push({ ply: state.ply, player, evaluator: kind, ...search.metadata });
            state = applySearchAction(modules, state, search.action, rules);
            if (search.action) actions.push(search.action);
            if ((state.ply - firstPly) % 4 === 0) {
              console.log(
                `${gameId}: ply ${state.ply}; ${kind}, profundidad ${search.metadata.completedDepth}, puntuación ${Math.round(search.metadata.score ?? 0)}, ${Math.round(search.metadata.elapsedMs)} ms.`,
              );
              report.inProgress = {
                gameId,
                pair: pair + 1,
                neuralPlayer,
                seed: opening.seed,
                initialLayout: opening.initialLayout,
                fortressHp: opening.fortressHp,
                initialState: opening.initialState,
                openingPlies: opening.actions.length,
                actions,
                finalState: state,
                searches,
                elapsedMs: performance.now() - startedAt,
                metrics: {
                  classical: describeSearchMetrics(gameMetrics.classical),
                  neural: describeSearchMetrics(gameMetrics.neural),
                },
              };
              await writeJsonCheckpoint(options.output, report);
            }
          }
          const game = {
            gameId,
            pair: pair + 1,
            neuralPlayer,
            seed: opening.seed,
            initialLayout: opening.initialLayout,
            fortressHp: opening.fortressHp,
            initialState: opening.initialState,
            openingPlies: opening.actions.length,
            actions,
            outcome: state.outcome,
            termination: state.outcome ? 'engine-outcome' : 'max-plies',
            finalState: state,
            elapsedMs: performance.now() - startedAt,
            searches,
            metrics: {
              classical: describeSearchMetrics(gameMetrics.classical),
              neural: describeSearchMetrics(gameMetrics.neural),
            },
          };
          report.games.push(game);
          delete report.inProgress;
          report.summary = summarizeArena(report.games);
          report.metrics = {
            classical: describeSearchMetrics(metrics.classical),
            neural: describeSearchMetrics(metrics.neural),
          };
          await writeJsonCheckpoint(options.output, report);
          console.log(
            `${gameId}: ${state.outcome ? JSON.stringify(state.outcome) : 'inconclusa (límite de jugadas)'}; ` +
              `${report.summary.wins} V / ${report.summary.draws} T / ${report.summary.losses} D / ${report.summary.inconclusive} inconclusas (red).`,
          );
        }
      }
      report.status = 'complete';
      report.finishedAt = new Date().toISOString();
      await writeJsonCheckpoint(options.output, report);
      console.log(`${report.summary.interpretation} Informe: ${resolve(options.output)}`);
    } catch (error) {
      report.status = 'failed';
      report.error = error instanceof Error ? error.message : String(error);
      await writeJsonCheckpoint(options.output, report);
      throw error;
    }
  } finally {
    await modules.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
