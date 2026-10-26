import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promotionPossible } from './selfplay-policy.mjs';
import {
  loadOpeningBook,
  openingBookResumeMatches,
  restoreBookCheckpoint,
} from './arena-openings.mjs';

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
    'reference-model': { type: 'string' },
    'reference-root': { type: 'string' },
    openings: { type: 'string' },
    pairs: { type: 'number', default: 4, integer: true, min: 1, max: 10_000 },
    output: { type: 'string', default: '.ai-lab/arena.json' },
    'candidate-profile': { type: 'string', default: 'model' },
    ablation: { type: 'boolean', default: false },
    resume: { type: 'boolean', default: false },
    'stop-on-rejection': { type: 'boolean', default: false },
    'minimum-score': { type: 'number', default: 0.6, min: 0, max: 1 },
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
--reference-model ruta sustituye Experto por otro modelo congelado, con los mismos límites.
--reference-root carpeta usa un buscador congelado, exigiendo idénticas reglas del motor.
--openings libro.json usa posiciones medias/finales con prefijos y reglas explícitas.
  Admite hex-arena-openings-v1 y hex-engine-endgames-v1; --pairs no puede superar sus familias.
  No añade órdenes aleatorias: --opening-plies solo afecta a las partidas iniciales predeterminadas.
--resume continúa el informe existente desde su último checkpoint de cuatro órdenes.
--stop-on-rejection termina si ya es imposible alcanzar el filtro de promoción.
El informe se guarda tras cada partida; los tiempos en Node no sustituyen medir el navegador.`);
    return;
  }
  const bytes = await readModelBytes(options.model);
  const modules = await loadGameModules();
  let referenceModules;
  try {
    const referenceSources = {};
    if (options['reference-root']) {
      for (const file of ['engine.ts', 'classic-rules.ts', 'hex.ts', 'types.ts']) {
        const sourceHash = async (root) =>
          createHash('sha256')
            .update(await readFile(resolve(root, 'src', file)))
            .digest('hex');
        if ((await sourceHash('.')) !== (await sourceHash(options['reference-root']))) {
          throw new Error(`La referencia no usa las mismas reglas: ${file}`);
        }
      }
      for (const file of [
        'ai.ts',
        'ai-airplane.ts',
        'ai-ranged.ts',
        'ai-material.ts',
        'ai-position.ts',
        'ai-neural.ts',
        'action-identity.ts',
      ]) {
        try {
          referenceSources[file] = createHash('sha256')
            .update(await readFile(resolve(options['reference-root'], 'src', file)))
            .digest('hex');
        } catch (error) {
          if (error.code !== 'ENOENT' || file !== 'ai-material.ts') throw error;
          referenceSources[file] = null;
        }
      }
      referenceModules = await loadGameModules({ root: options['reference-root'] });
    }
    const evaluate = modules.neural.createNeuralEvaluator(bytes);
    const referenceBytes = options['reference-model']
      ? await readModelBytes(options['reference-model'])
      : undefined;
    const referenceEvaluate = referenceBytes
      ? (referenceModules ?? modules).neural.createNeuralEvaluator(referenceBytes)
      : undefined;
    const metadata = modules.neural.parseNeuralModel(bytes).metadata;
    const referenceMetadata = referenceBytes
      ? (referenceModules ?? modules).neural.parseNeuralModel(referenceBytes).metadata
      : null;
    const profile =
      options['candidate-profile'] === 'model'
        ? (evaluate.searchProfile ?? 'classic')
        : options['candidate-profile'];
    if (!['classic', 'pvs-history', 'pvs-threats'].includes(profile)) {
      throw new Error('--candidate-profile debe ser model, classic, pvs-history o pvs-threats.');
    }
    const rules = { ...modules.engine.DEFAULT_ACTION_RESOLUTION_RULES };
    if (options.openings && options['fortress-hp'] !== undefined)
      throw new Error(
        '--fortress-hp no puede sustituir la vida declarada en un libro de aperturas.',
      );
    const openingBook = options.openings
      ? await loadOpeningBook(modules.engine, options.openings, {
          pairs: options.pairs,
          seed: options.seed,
        })
      : null;
    const standardExpertCaps =
      options['budget-ms'] === EXPERT_BUDGET_MS && options.depth === EXPERT_DEPTH;
    const metrics = { classical: newSearchMetrics(), neural: newSearchMetrics() };
    let report = {
      format: 'hexagonal-neural-arena',
      version: 1,
      status: 'running',
      createdAt: new Date().toISOString(),
      settings: options,
      model: {
        path: resolve(options.model),
        sha256: createHash('sha256').update(new Uint8Array(bytes)).digest('hex'),
        schema: metadata.featureSchema,
        inputSize: metadata.inputSize,
        bytes: bytes.byteLength,
        evaluation: metadata.evaluation ?? 'standalone-v1',
        residualScale: metadata.residualScale ?? null,
        residualBaseline: metadata.residualBaseline ?? null,
        residualSymmetry: metadata.residualSymmetry ?? null,
        includesRangedValue: metadata.includesRangedValue === true,
      },
      candidate: {
        searchProfile: profile,
        evaluator: options.ablation ? 'classical-ablation' : 'neural',
        variety: profile === 'classic' ? 'expert-default' : 'best-score',
        rangedEvaluation:
          profile === 'pvs-threats'
            ? metadata.includesRangedValue === true && !options.ablation
              ? 'included-in-neural-estimate-v1'
              : 'ranged-v1'
            : null,
      },
      referenceExpert: {
        difficulty: 'expert',
        personality: 'balanced',
        depth: 9,
        budgetMs: 15_000,
      },
      referenceModel: referenceBytes
        ? {
            path: resolve(options['reference-model']),
            sha256: createHash('sha256').update(new Uint8Array(referenceBytes)).digest('hex'),
            schema: referenceMetadata.featureSchema,
            inputSize: referenceMetadata.inputSize,
          }
        : null,
      referenceRoot: options['reference-root'] ? resolve(options['reference-root']) : null,
      referenceSources,
      standardExpertCaps,
      budgetDescription: standardExpertCaps
        ? 'Presupuesto y profundidad máxima del Experto actual.'
        : `Ensayo con límites modificados: ${options['budget-ms']} ms, profundidad ${options.depth}. No equivale al Experto de 15 s/profundidad 9.`,
      environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      rules: openingBook ? null : rules,
      scope: openingBook ? openingBook.identity.scope : 'fullgame',
      ...(openingBook ? { openingBook: openingBook.identity } : {}),
      pairing: 'Identical seeded opening and search seeds per pair; neural plays each side once.',
      games: [],
      summary: summarizeArena([]),
      metrics: {},
    };
    if (options.resume) {
      const saved = JSON.parse(await readFile(resolve(options.output), 'utf8'));
      const settings = ({ resume: _resume, ...rest }) => {
        void _resume;
        return rest;
      };
      if (
        JSON.stringify(settings(saved.settings)) !== JSON.stringify(settings(options)) ||
        saved.model.sha256 !== report.model.sha256 ||
        saved.referenceModel?.sha256 !== report.referenceModel?.sha256 ||
        JSON.stringify(saved.referenceSources ?? {}) !== JSON.stringify(report.referenceSources) ||
        !openingBookResumeMatches(saved, report)
      ) {
        throw new Error('El torneo guardado no coincide con los parámetros o modelos actuales.');
      }
      if (['complete', 'rejected'].includes(saved.status)) return;
      report = saved;
      report.status = 'running';
      delete report.error;
      for (const game of [...report.games, ...(report.inProgress ? [report.inProgress] : [])]) {
        for (const search of game.searches) addSearchMetrics(metrics[search.evaluator], search);
      }
    }
    await writeJsonCheckpoint(options.output, report);
    console.log(report.budgetDescription);
    try {
      const rejectIfImpossible = async () => {
        if (
          !options['stop-on-rejection'] ||
          promotionPossible(report.games, {
            pairs: options.pairs,
            minimumScore: options['minimum-score'],
          })
        )
          return false;
        report.status = 'rejected';
        report.rejection =
          'No puede alcanzar los mínimos aunque gane todas las partidas restantes.';
        delete report.inProgress;
        report.finishedAt = new Date().toISOString();
        await writeJsonCheckpoint(options.output, report);
        console.log(report.rejection);
        return true;
      };
      if (await rejectIfImpossible()) return;
      for (let pair = 0; pair < options.pairs; pair += 1) {
        const opening = openingBook
          ? openingBook.openings[pair]
          : createOpening(modules, {
              seed: options.seed,
              index: pair,
              openingPlies: options['opening-plies'],
              fortressHp: options['fortress-hp'],
            });
        const gameRules = opening.rules ?? rules;
        for (const neuralPlayer of [0, 1]) {
          const gameId = `pair-${pair + 1}-neural-${neuralPlayer}`;
          if (report.games.some((game) => game.gameId === gameId)) continue;
          const partial = report.inProgress?.gameId === gameId ? report.inProgress : undefined;
          let state = openingBook
            ? restoreBookCheckpoint(modules.engine, opening, partial)
            : modules.engine.cloneState(partial?.finalState ?? opening.state);
          const firstPly = opening.state.ply;
          const actions = [...(partial?.actions ?? opening.actions)];
          const searches = [...(partial?.searches ?? [])];
          const gameMetrics = { classical: newSearchMetrics(), neural: newSearchMetrics() };
          for (const search of searches) addSearchMetrics(gameMetrics[search.evaluator], search);
          const startedAt = performance.now() - (partial?.elapsedMs ?? 0);
          console.log(
            openingBook
              ? `${gameId}: inicio; libro ${opening.id}, familia ${opening.familyId}, ámbito ${opening.scope}.`
              : `${gameId}: inicio; disposición ${opening.initialLayout}, HP ${opening.fortressHp}.`,
          );
          while (!state.outcome && state.ply - firstPly < options['max-plies']) {
            const player = state.activePlayer;
            const kind = player === neuralPlayer ? 'neural' : 'classical';
            const searchModules = kind === 'classical' ? (referenceModules ?? modules) : modules;
            const search = searchModules.ai.searchMachineActionWithMetadata(state, {
              depth: options.depth,
              budgetMs: options['budget-ms'],
              difficulty: 'expert',
              personality: 'balanced',
              seed: deriveSeed(opening.seed, state.ply),
              resolutionRules: gameRules,
              ...(kind === 'neural'
                ? {
                    evaluate: options.ablation
                      ? (position, player) => modules.ai.evaluateClassicState(position, player)
                      : evaluate,
                    searchProfile: profile,
                  }
                : referenceEvaluate
                  ? { evaluate: referenceEvaluate }
                  : {}),
            });
            addSearchMetrics(metrics[kind], search.metadata);
            addSearchMetrics(gameMetrics[kind], search.metadata);
            searches.push({ ply: state.ply, player, evaluator: kind, ...search.metadata });
            state = applySearchAction(modules, state, search.action, gameRules);
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
                ...(openingBook
                  ? {
                      openingId: opening.id,
                      familyId: opening.familyId,
                      ...(opening.drawId ? { drawId: opening.drawId } : {}),
                      scope: opening.scope,
                      rules: gameRules,
                    }
                  : {}),
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
            ...(openingBook
              ? {
                  openingId: opening.id,
                  familyId: opening.familyId,
                  ...(opening.drawId ? { drawId: opening.drawId } : {}),
                  scope: opening.scope,
                  rules: gameRules,
                }
              : {}),
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
          if (await rejectIfImpossible()) return;
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
    await referenceModules?.close();
    await modules.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
