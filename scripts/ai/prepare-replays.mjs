import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  loadGameModules,
  parseArguments,
  outcomeForPerspective,
  validateSparseFeatures,
  writeJsonCheckpoint,
} from './shared.mjs';
import { experimentSeed, trainingTarget } from './selfplay-policy.mjs';

const options = parseArguments(process.argv.slice(2), {
  records: { type: 'string', required: true },
  selfplay: { type: 'string' },
  output: { type: 'string', required: true },
  positions: { type: 'number', default: 8, integer: true, min: 2, max: 1000 },
  'budget-ms': { type: 'number', default: 750, integer: true, min: 20, max: 120000 },
  depth: { type: 'number', default: 5, integer: true, min: 1, max: 12 },
  seed: { type: 'number', default: 20261020, integer: true, min: 0, max: 4294967295 },
});
const digest = (value) => createHash('sha256').update(value).digest('hex');
const modules = await loadGameModules();
let output;
try {
  const sources = [];
  for (const file of (await readdir(resolve(options.records)))
    .filter((file) => file.endsWith('.json'))
    .sort()) {
    const path = resolve(options.records, file);
    const bytes = await readFile(path, 'utf8');
    const record = modules.records.parseRecord(bytes);
    sources.push({
      source: 'human',
      path,
      file,
      sha256: digest(bytes),
      initialState: record.initialState,
      actions: record.actions,
      rules: modules.records.resolutionRulesForConfig(record.config),
      conclusion: record.conclusion?.outcome ?? null,
    });
  }
  if (options.selfplay) {
    const rows = (await readFile(resolve(options.selfplay), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map(JSON.parse);
    if (rows[0]?.kind !== 'metadata' || !rows[0].rules)
      throw new Error('Dataset de autojuego sin reglas.');
    for (const row of rows.filter((row) => row.kind === 'game')) {
      sources.push({
        ...row,
        source: 'selfplay',
        rules: row.rules ?? rows[0].rules,
        path: resolve(options.selfplay),
        file: row.gameId,
      });
    }
  }
  const report = {
    status: 'running',
    settings: options,
    evaluationVersion: 'strategic-v2',
    createdAt: new Date().toISOString(),
    sourceHashes: {},
    games: [],
    samples: 0,
    skipped: 0,
  };
  for (const file of [
    'src/ai.ts',
    'src/ai-material.ts',
    'src/ai-airplane.ts',
    'src/ai-ranged.ts',
    'src/engine.ts',
  ]) {
    report.sourceHashes[file] = digest(await readFile(file));
  }
  await mkdir(dirname(resolve(options.output)), { recursive: true });
  output = await open(resolve(options.output), 'wx');
  const write = (value) => output.write(`${JSON.stringify(value)}\n`);
  await write({
    kind: 'metadata',
    format: 'hexagonal-neural-dataset',
    version: 1,
    schema: modules.neural.NEURAL_FEATURE_SCHEMA,
    inputSize: modules.neural.NEURAL_INPUT_SIZE,
    teacherScale: 10000,
    featureEncoding: 'sparse-binary-indices',
    target: 'classic-residual-v1',
    residualScale: 2000,
    residualBaseline: 'classic+ranged-v1',
    labelVersion: 'bounded-outcome-v2',
    evaluationVersion: report.evaluationVersion,
    sourceHashes: report.sourceHashes,
    settings: options,
    rules: 'Per-game and per-sample; historical configurations are preserved.',
    teacher:
      'Current classical evaluation, pvs-threats and ranged heuristics; no learned correction.',
  });
  const identities = new Set();
  for (const [gameIndex, game] of sources.entries()) {
    const identity = digest(
      JSON.stringify({ initialState: game.initialState, actions: game.actions, rules: game.rules }),
    );
    if (identities.has(identity)) continue;
    identities.add(identity);
    const gameId = `replay-${identity.slice(0, 32)}`;
    const first = Math.min(6, Math.max(0, game.actions.length - 1));
    const selected = new Set(
      Array.from({ length: Math.min(options.positions, game.actions.length) }, (_, index) =>
        Math.floor(
          first +
            (index * (game.actions.length - 1 - first)) /
              Math.max(1, Math.min(options.positions, game.actions.length) - 1),
        ),
      ),
    );
    let state = modules.engine.cloneState(game.initialState);
    const positions = [];
    for (const [index, action] of game.actions.entries()) {
      if (selected.has(index)) positions.push(state);
      const resolved = modules.engine.applyAction(state, action, game.rules);
      if (!resolved.ok) throw new Error(`Replay ilegal: ${game.file}, orden ${index + 1}`);
      state = resolved.state;
    }
    const outcome = state.outcome;
    let accepted = 0;
    let skipped = 0;
    for (const position of positions) {
      if (position.outcome) continue;
      const search = modules.ai.searchMachineActionWithMetadata(position, {
        difficulty: 'expert',
        personality: 'balanced',
        depth: options.depth,
        budgetMs: options['budget-ms'],
        resolutionRules: game.rules,
        searchProfile: 'pvs-threats',
        seed: experimentSeed(options.seed, gameIndex, 'relabel', position.ply),
      });
      if (!search.metadata.completedDepth || !Number.isFinite(search.metadata.score)) {
        skipped += 1;
        continue;
      }
      for (const perspective of [0, 1]) {
        const teacherScore =
          search.metadata.score * (position.activePlayer === perspective ? 1 : -1);
        const baseline =
          modules.ai.evaluateClassicState(position, perspective) +
          modules.ranged.evaluateRangedState(position, perspective);
        const result = outcomeForPerspective(outcome, perspective);
        const features = modules.neural.encodeNeuralFeatures(position, perspective, game.rules);
        validateSparseFeatures(features, modules.neural.NEURAL_INPUT_SIZE);
        await write({
          kind: 'sample',
          gameId,
          perspective,
          ply: position.ply,
          features,
          teacher: trainingTarget({
            teacher: Math.tanh(teacherScore / 10000),
            teacherScore,
            baseline,
            residual: true,
            outcome: result,
            outcomeWeight: 0.25,
            remainingPlies: state.ply - position.ply,
          }),
          outcome: result,
          teacherScore,
          baseline,
          completedDepth: search.metadata.completedDepth,
          rules: game.rules,
        });
      }
      accepted += 1;
    }
    const entry = {
      gameId,
      source: game.source,
      file: game.file,
      identity,
      outcome,
      externalConclusion: game.conclusion ?? null,
      samples: accepted * 2,
      skipped,
    };
    report.games.push(entry);
    report.samples += accepted * 2;
    report.skipped += skipped;
    await write({
      kind: 'game',
      ...entry,
      initialState: game.initialState,
      actions: game.actions,
      finalPly: state.ply,
      rules: game.rules,
      termination: outcome ? 'engine-outcome' : 'unfinished-board',
    });
    await output.sync();
    await writeJsonCheckpoint(`${options.output}.report.json`, report);
    console.log(
      `${report.games.length}/${sources.length}: ${game.source}, ${accepted * 2} muestras, ${skipped} sin iteración completa.`,
    );
  }
  report.status = 'complete';
  await writeJsonCheckpoint(`${options.output}.report.json`, report);
} finally {
  await output?.close();
  await modules.close();
}
