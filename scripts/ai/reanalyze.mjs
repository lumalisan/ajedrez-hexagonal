import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadGameModules,
  outcomeForPerspective,
  parseArguments,
  writeJsonCheckpoint,
} from './shared.mjs';
import { experimentSeed, trainingTarget } from './selfplay-policy.mjs';
import { acquireResearchLock } from './research-state.mjs';
import {
  canonicalJson,
  digest,
  encodeResearchPosition,
  parseResearchInput,
  reconstructResearchGame,
  selectPositionIndices,
} from './research-data.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const definitions = {
  input: { type: 'string', required: true },
  output: { type: 'string', required: true },
  target: { type: 'string', default: 'classic-residual-v1' },
  'teacher-model': { type: 'string' },
  positions: { type: 'number', default: 1000, integer: true, min: 1, max: 1000000 },
  'positions-per-game': { type: 'number', default: 8, integer: true, min: 1, max: 10000 },
  'min-gap': { type: 'number', default: 4, integer: true, min: 1, max: 10000 },
  'budget-ms': { type: 'number', default: 5000, integer: true, min: 20, max: 120000 },
  depth: { type: 'number', default: 9, integer: true, min: 1, max: 12 },
  'minimum-depth': { type: 'number', default: 3, integer: true, min: 1, max: 12 },
  'probe-budget-ms': { type: 'number', default: 0, integer: true, min: 0, max: 120000 },
  'max-search-ms': { type: 'number', default: 0, integer: true, min: 0, max: 1000000000 },
  seed: { type: 'number', default: 20261023, integer: true, min: 0, max: 4294967295 },
  resume: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
};

export function reanalysisOptions(argv) {
  const options = parseArguments(argv, definitions);
  if (options.help) return options;
  if (!['classic-residual-v1', 'material-residual-v1'].includes(options.target))
    throw new Error('--target incompatible.');
  if (options['teacher-model'] && options.target !== 'material-residual-v1')
    throw new Error('--teacher-model requiere --target material-residual-v1.');
  if (options['minimum-depth'] > options.depth) {
    throw new Error('--minimum-depth no puede superar --depth.');
  }
  if (options['probe-budget-ms'] && options['probe-budget-ms'] < 20) {
    throw new Error('--probe-budget-ms debe ser 0 o al menos 20.');
  }
  return options;
}

async function readIfPresent(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function sourceHashes() {
  const files = [
    'scripts/ai/reanalyze.mjs',
    'scripts/ai/research-data.mjs',
    'scripts/ai/research-state.mjs',
    'scripts/ai/shared.mjs',
    'scripts/ai/selfplay-policy.mjs',
    'src/ai.ts',
    'src/ai-airplane.ts',
    'src/ai-material.ts',
    'src/ai-position.ts',
    'src/ai-ranged.ts',
    'src/ai-neural.ts',
    'src/ai-neural-baseline.ts',
    'src/engine.ts',
    'src/action-identity.ts',
    'src/hex.ts',
    'src/types.ts',
    'src/classic-rules.ts',
    'src/setup.ts',
  ];
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [file, digest(await readFile(resolve(root, file)))]),
    ),
  );
}

/** Checkpoints own all emitted rows, so interruption cannot leave half of a perspective pair. */
async function save(output, reportPath, state, header, games) {
  const counts = new Map();
  for (const sample of state.samples)
    counts.set(sample.gameId, (counts.get(sample.gameId) ?? 0) + 1);
  const rows = [
    header,
    ...games.map((game) => ({
      kind: 'game',
      gameId: game.gameId,
      familyId: game.familyId,
      identity: game.identity,
      sourceGameId: game.sourceGameId,
      initialState: game.initialState,
      actions: game.actions,
      rules: game.rules,
      outcome: game.knownOutcome,
      knownOutcome: game.knownOutcome,
      finalPly: game.finalPly,
      termination: game.knownOutcome ? 'engine-outcome' : 'unfinished-board',
      samples: counts.get(game.gameId) ?? 0,
    })),
    ...state.samples,
  ];
  const bytes = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const outputHash = digest(bytes);
  if (outputHash !== state.outputHash) {
    state.previousOutputHash = state.outputHash ?? null;
    state.outputHash = outputHash;
  }
  state.updatedAt = new Date().toISOString();
  await writeJsonCheckpoint(reportPath, state);
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, output);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

function searchSummary(search) {
  return {
    ...search.metadata,
    action: search.action,
    principalVariation: search.principalVariation ?? null,
    principalVariationAvailable: Array.isArray(search.principalVariation),
  };
}

function actionIdentity(action) {
  return action === null ? null : canonicalJson(action);
}

/** A model teacher is an explicit frozen input, separate from the candidate being trained. */
export async function runReanalysis(options, dependencies = {}) {
  if (
    !['classic-residual-v1', 'material-residual-v1'].includes(
      options.target ?? 'classic-residual-v1',
    )
  )
    throw new Error('--target incompatible.');
  if (options['teacher-model'] && options.target !== 'material-residual-v1')
    throw new Error('--teacher-model requiere --target material-residual-v1.');
  const input = resolve(options.input);
  const output = resolve(options.output);
  const reportPath = `${output}.report.json`;
  const lockPath = `${output}.lock`;
  if ([output, reportPath, lockPath].includes(input))
    throw new Error('Entrada y salidas deben diferir.');
  const inputBytes = await readFile(input, 'utf8');
  const materialResidual = options.target === 'material-residual-v1';
  if (materialResidual) {
    let source;
    try {
      source = JSON.parse(inputBytes);
    } catch {
      source = JSON.parse(inputBytes.trim().split(/\r?\n/)[0]);
    }
    if (source.sourceRole !== 'development')
      throw new Error('El residuo material requiere sourceRole: development.');
  }
  const teacherBytes = options['teacher-model']
    ? await readFile(resolve(options['teacher-model']))
    : null;
  const teacherModel = teacherBytes
    ? { path: resolve(options['teacher-model']), sha256: digest(teacherBytes) }
    : null;
  const hashes = dependencies.sourceHashes ?? (await sourceHashes());
  const { resume: _resume, help: _help, 'max-search-ms': _limit, ...settings } = options;
  void _resume;
  void _help;
  void _limit;
  settings.input = input;
  settings.output = output;
  const identity = digest(
    canonicalJson({
      inputHash: digest(inputBytes),
      settings,
      sourceHashes: hashes,
      ...(teacherModel ? { teacherModel } : {}),
    }),
  );
  await mkdir(dirname(output), { recursive: true });
  const release = await acquireResearchLock(lockPath, Boolean(options.resume));
  let modules;
  try {
    const savedText = await readIfPresent(reportPath);
    const existingOutput = await readIfPresent(output);
    if (!options.resume && (savedText !== null || existingOutput !== null)) {
      throw new Error('La salida ya existe; usa otra ruta o --resume.');
    }
    if (options.resume && savedText === null) throw new Error('No hay checkpoint para reanudar.');
    let state = savedText
      ? JSON.parse(savedText)
      : {
          format: 'hexagonal-reanalysis-checkpoint',
          version: 1,
          identity,
          settings,
          sourceHashes: hashes,
          inputHash: digest(inputBytes),
          createdAt: new Date().toISOString(),
          status: 'running',
          cursor: 0,
          samples: [],
          attempts: [],
          nominalSearchMs: 0,
        };
    if (state.identity !== identity || state.format !== 'hexagonal-reanalysis-checkpoint') {
      throw new Error('El checkpoint no coincide con entrada, código o configuración.');
    }
    if (
      existingOutput !== null &&
      ![state.outputHash, state.previousOutputHash].includes(digest(existingOutput))
    ) {
      throw new Error('La salida ha cambiado fuera del proceso; se conserva sin sobrescribir.');
    }
    modules = dependencies.modules ?? (await loadGameModules());
    const teacherEvaluate = teacherBytes
      ? modules.neural.createNeuralEvaluator(
          teacherBytes.buffer.slice(
            teacherBytes.byteOffset,
            teacherBytes.byteOffset + teacherBytes.byteLength,
          ),
        )
      : undefined;
    const schema = materialResidual
      ? modules.neural.NEURAL_FEATURE_SCHEMA_V2
      : modules.neural.NEURAL_FEATURE_SCHEMA;
    const games = parseResearchInput(inputBytes).map((game) => {
      const seed = experimentSeed(options.seed, 0, game.identity);
      const indices = selectPositionIndices(
        game.actions.length,
        options['positions-per-game'],
        options['min-gap'],
        seed,
      );
      return reconstructResearchGame(game, modules, indices);
    });
    const fingerprints = new Set();
    const tasks = [];
    const orderedGames = [...games].sort((left, right) =>
      digest(`${options.seed}:${left.identity}`).localeCompare(
        digest(`${options.seed}:${right.identity}`),
      ),
    );
    for (
      let slot = 0;
      slot < options['positions-per-game'] && tasks.length < options.positions;
      slot += 1
    ) {
      for (const game of orderedGames) {
        if (tasks.length >= options.positions) break;
        const index = game.selectedIndices[slot];
        if (index === undefined) continue;
        const position = game.positions[index];
        const encoded = encodeResearchPosition(position, game.rules, modules, schema);
        if (fingerprints.has(encoded.fingerprint)) continue;
        fingerprints.add(encoded.fingerprint);
        tasks.push({ game, position, ...encoded });
      }
    }
    const header = {
      kind: 'metadata',
      format: 'hexagonal-neural-dataset',
      version: 1,
      schema,
      inputSize: materialResidual
        ? modules.neural.NEURAL_INPUT_SIZE_V2
        : modules.neural.NEURAL_INPUT_SIZE,
      featureEncoding: 'sparse-binary-indices',
      teacherScale: 10000,
      target: materialResidual ? 'material-residual-v1' : 'classic-residual-v1',
      residualScale: 2000,
      residualBaseline: materialResidual
        ? modules.neural.NEURAL_MATERIAL_BASELINE
        : 'classic+ranged-v1',
      ...(materialResidual ? { includesRangedValue: true, sourceRole: 'development' } : {}),
      labelVersion: materialResidual ? 'raw-search-material-residual-v1' : 'bounded-outcome-v2',
      evaluationVersion: materialResidual
        ? modules.neural.NEURAL_MATERIAL_BASELINE
        : 'strategic-v2',
      sourceHashes: hashes,
      settings,
      rules: 'Per-game and per-sample; preserved from explicit input.',
      teacher: {
        evaluator: teacherModel ? 'frozen-neural-model' : 'classic',
        searchProfile: 'pvs-threats',
        rangedEvaluation: teacherEvaluate?.includesRangedValue
          ? 'included-in-neural-estimate-v1'
          : 'ranged-v1',
        neural: Boolean(teacherModel),
        ...(teacherModel ? { model: teacherModel } : {}),
      },
      input: { path: input, sha256: digest(inputBytes) },
      reanalysisIdentity: identity,
      grouping:
        'Canonical replay identity; preserved familyId for family-based splitting. Replace original labels rather than append their old gameIds.',
      createdAt: state.createdAt,
    };
    const search = dependencies.search ?? modules.ai.searchMachineActionWithMetadata;
    let invocationBudget = 0;
    state.totalSelectedPositions = tasks.length;
    state.status = 'running';
    await save(output, reportPath, state, header, games);
    while (state.cursor < tasks.length) {
      const cost = options['budget-ms'] + options['probe-budget-ms'];
      if (options['max-search-ms'] && invocationBudget + cost > options['max-search-ms']) {
        state.status = 'budget-limited';
        break;
      }
      const { game, position, features, fingerprint } = tasks[state.cursor];
      const searchOptions = {
        difficulty: 'expert',
        personality: 'balanced',
        depth: options.depth,
        budgetMs: options['budget-ms'],
        resolutionRules: game.rules,
        searchProfile: 'pvs-threats',
        rangedPlay: true,
        ...(teacherEvaluate ? { evaluate: teacherEvaluate } : {}),
        seed: experimentSeed(options.seed, 0, game.identity, position.ply),
      };
      const teacher = await search(position, searchOptions);
      const probe = options['probe-budget-ms']
        ? await search(position, {
            ...searchOptions,
            budgetMs: options['probe-budget-ms'],
          })
        : null;
      invocationBudget += cost;
      state.nominalSearchMs += cost;
      const valid =
        teacher.metadata.completedDepth >= options['minimum-depth'] &&
        Number.isFinite(teacher.metadata.score);
      const validProbe =
        probe && probe.metadata.completedDepth > 0 && Number.isFinite(probe.metadata.score);
      const confidence = {
        probe: probe ? searchSummary(probe) : null,
        probeUsable: Boolean(validProbe),
        scoreDelta: validProbe ? teacher.metadata.score - probe.metadata.score : null,
        absoluteScoreDelta: validProbe
          ? Math.abs(teacher.metadata.score - probe.metadata.score)
          : null,
        sameAction: validProbe
          ? actionIdentity(teacher.action) === actionIdentity(probe.action)
          : null,
      };
      state.attempts.push({
        gameId: game.gameId,
        familyId: game.familyId,
        ply: position.ply,
        fingerprint,
        accepted: valid,
        reason: valid ? null : 'minimum-depth-or-nonfinite-score',
        teacher: searchSummary(teacher),
        confidence,
      });
      if (valid) {
        for (const perspective of [0, 1]) {
          const teacherScore =
            teacher.metadata.score * (position.activePlayer === perspective ? 1 : -1);
          const baseline = materialResidual
            ? modules.neural.evaluateNeuralMaterialBaseline(position, perspective)
            : modules.ai.evaluateClassicState(position, perspective) +
              modules.ranged.evaluateRangedState(position, perspective);
          const outcome = outcomeForPerspective(game.knownOutcome, perspective);
          state.samples.push({
            kind: 'sample',
            gameId: game.gameId,
            familyId: game.familyId,
            perspective,
            ply: position.ply,
            features: features[perspective],
            rules: game.rules,
            fingerprint,
            teacher: materialResidual
              ? Math.max(-1, Math.min(1, (teacherScore - baseline) / 2000))
              : trainingTarget({
                  teacher: Math.tanh(teacherScore / 10000),
                  teacherScore,
                  baseline,
                  residual: true,
                  outcome,
                  outcomeWeight: 0.25,
                  remainingPlies: game.finalPly - position.ply,
                }),
            outcome,
            teacherScore,
            baseline,
            completedDepth: teacher.metadata.completedDepth,
            teacherSearch: searchSummary(teacher),
            confidence,
          });
        }
      }
      state.cursor += 1;
      await save(output, reportPath, state, header, games);
    }
    if (digest(await readFile(input, 'utf8')) !== digest(inputBytes))
      throw new Error('La entrada cambió durante el reanálisis.');
    if (teacherModel && digest(await readFile(teacherModel.path)) !== teacherModel.sha256)
      throw new Error('El modelo profesor cambió durante el reanálisis.');
    if (state.cursor === tasks.length) state.status = 'complete';
    state.acceptedPositions = state.samples.length / 2;
    state.rejectedPositions = state.attempts.length - state.acceptedPositions;
    await save(output, reportPath, state, header, games);
    return state;
  } finally {
    try {
      if (!dependencies.modules) await modules?.close();
    } finally {
      await release();
    }
  }
}

async function main() {
  const options = reanalysisOptions(process.argv.slice(2));
  if (options.help) {
    console.log(`Reanaliza únicamente partidas del archivo indicado con un profesor clásico o un modelo congelado explícito.
pnpm exec node scripts/ai/reanalyze.mjs --input partidas.jsonl --output profesor.jsonl
  --positions 100 --positions-per-game 8 --min-gap 4 --budget-ms 5000 --depth 9
  --minimum-depth 3 --seed 20261023 [--probe-budget-ms 1000] [--max-search-ms 60000] [--resume]
  [--target material-residual-v1 --teacher-model campeon-congelado.bin]
--positions limita el total; --positions-per-game limita cada trayectoria.
El presupuesto total es nominal, por invocación; una búsqueda puede exceder su límite ligeramente.
La reanudación exige entrada, código y opciones idénticos, salvo el presupuesto total de esa invocación.
No lee otras carpetas, no publica modelos y no convierte reloj o rendición en etiquetas.
El objetivo material usa V2, requiere entradas de desarrollo, resta su base versionada del valor de búsqueda sin recortar previamente el total y no mezcla desenlaces posteriores.
--resume recupera bloqueos huérfanos tras verificar que su PID ya no existe.`);
    return;
  }
  const report = await runReanalysis(options);
  console.log(
    `${report.status}: ${report.acceptedPositions} posiciones aceptadas, ${report.rejectedPositions} rechazadas; ${report.samples.length} muestras.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
