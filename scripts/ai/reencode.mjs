import { createHash } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, normalizeRules } from './research-data.mjs';
import { loadGameModules, parseArguments, validateSparseFeatures } from './shared.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const sourceFiles = [
  'scripts/ai/reencode.mjs',
  'scripts/ai/research-data.mjs',
  'scripts/ai/shared.mjs',
  'src/ai-neural.ts',
  'src/ai-neural-baseline.ts',
  'src/engine.ts',
  'src/classic-rules.ts',
  'src/hex.ts',
  'src/types.ts',
  'src/setup.ts',
  'src/action-identity.ts',
];

function rulesFor(value) {
  if (
    value &&
    Object.keys(value).some(
      (key) => !['repetition', 'noProgressPlyLimit', 'orientationOnlyTurnLimit'].includes(key),
    )
  )
    throw new Error('Regla desconocida en el dataset.');
  return normalizeRules(value);
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function validatePair(pair, game) {
  if (pair.length !== 2 || new Set(pair.map((row) => row.perspective)).size !== 2)
    throw new Error('Cada posición necesita una pareja completa de perspectivas 0 y 1.');
  for (const sample of pair) {
    const family = sample.familyId ?? sample.sourceFamilyId ?? sample.gameId;
    if (family !== (game.familyId ?? game.sourceFamilyId ?? game.gameId))
      throw new Error(`Familia contradictoria: ${sample.gameId}.`);
    if (!same(rulesFor(sample.rules ?? game.rules), game.rules))
      throw new Error(`Reglas contradictorias: ${sample.gameId}, ply ${sample.ply}.`);
  }
  for (const field of ['teacher', 'outcome', 'teacherScore', 'baseline', 'target']) {
    const [first, second] = pair.map((row) => row[field]);
    if (field === 'target' && typeof first !== 'number' && typeof second !== 'number') continue;
    if (first === undefined && second === undefined) continue;
    if (first === null && second === null) continue;
    if (
      typeof first !== 'number' ||
      !Number.isFinite(first) ||
      typeof second !== 'number' ||
      !Number.isFinite(second) ||
      Math.abs(first + second) > 1e-6
    )
      throw new Error(
        `Etiquetas ${field} no opuestas en la pareja: ${game.gameId}, ply ${pair[0].ply}.`,
      );
  }
}

/** Pure conversion: replay/verify every V1 sample; preserve every field except features/header. */
export function reencodeRows(rows, schema, modules) {
  const { engine, neural } = modules;
  if (schema !== neural.NEURAL_FEATURE_SCHEMA_V2)
    throw new Error('Solo se admite destino hex-sparse-v2.');
  const header = rows?.[0];
  if (
    !Array.isArray(rows) ||
    header?.kind !== 'metadata' ||
    header.format !== 'hexagonal-neural-dataset' ||
    header.version !== 1 ||
    header.schema !== neural.NEURAL_FEATURE_SCHEMA ||
    header.inputSize !== neural.NEURAL_INPUT_SIZE
  )
    throw new Error('Se requiere un dataset teacher V1 con schema hex-sparse-v1 e inputSize 5183.');
  if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row)))
    throw new Error('Fila JSONL inválida.');
  const games = new Map();
  const pairs = new Map();
  const samples = rows.filter((row) => row.kind === 'sample');
  if (!samples.length) throw new Error('El dataset no contiene muestras para recodificar.');
  for (const row of rows.slice(1)) {
    if (row.kind === 'metadata') throw new Error('El dataset contiene otra cabecera metadata.');
    if (row.kind !== 'game') continue;
    if (
      typeof row.gameId !== 'string' ||
      !row.gameId ||
      games.has(row.gameId) ||
      !row.initialState ||
      !Array.isArray(row.actions)
    )
      throw new Error('Partida sin identidad/trayectoria o gameId duplicado.');
    const gameRules = rulesFor(row.rules ?? header.rules);
    const family = row.familyId ?? row.sourceFamilyId ?? row.gameId;
    if (typeof family !== 'string' || !family) throw new Error('Familia de partida inválida.');
    games.set(row.gameId, { ...row, rules: gameRules, positions: new Map(), needed: new Set() });
  }
  for (const sample of samples) {
    const game = games.get(sample.gameId);
    if (!game) throw new Error(`Muestra sin trayectoria: ${sample.gameId}.`);
    if (![0, 1].includes(sample.perspective) || !Number.isSafeInteger(sample.ply) || sample.ply < 0)
      throw new Error('Perspectiva o ply inválido en una muestra.');
    if (typeof sample.teacher !== 'number' || !Number.isFinite(sample.teacher))
      throw new Error('Muestra sin etiqueta teacher finita.');
    validateSparseFeatures(sample.features, neural.NEURAL_INPUT_SIZE);
    const key = canonicalJson([sample.gameId, sample.ply]);
    const pair = pairs.get(key) ?? [];
    if (pair.some((row) => row.perspective === sample.perspective))
      throw new Error('Perspectiva duplicada para una posición.');
    pair.push(sample);
    pairs.set(key, pair);
    game.needed.add(sample.ply);
  }
  for (const pair of pairs.values()) validatePair(pair, games.get(pair[0].gameId));
  // Replay all trajectories, even unused games. Do not silently discard source rows or actions.
  for (const game of games.values()) {
    if (engine.validateState(game.initialState).length)
      throw new Error(`Estado inicial inválido: ${game.gameId}.`);
    let state = engine.cloneState(game.initialState);
    const remember = () => {
      if (game.needed.has(state.ply)) game.positions.set(state.ply, state);
    };
    remember();
    for (const [index, action] of game.actions.entries()) {
      if (state.outcome) throw new Error(`Acciones después del final: ${game.gameId}.`);
      const result = engine.applyAction(state, action, game.rules);
      if (!result.ok) throw new Error(`Replay ilegal: ${game.gameId}, orden ${index + 1}.`);
      state = result.state;
      remember();
    }
    if (game.positions.size !== game.needed.size)
      throw new Error(`Hay muestras cuyo ply no pertenece a la trayectoria: ${game.gameId}.`);
  }
  const converted = new Map();
  for (const sample of samples) {
    const game = games.get(sample.gameId);
    const state = game.positions.get(sample.ply);
    const previous = neural.encodeNeuralFeatures(
      state,
      sample.perspective,
      game.rules,
      neural.NEURAL_FEATURE_SCHEMA,
    );
    if (!same(previous, sample.features))
      throw new Error(
        `Las características V1 no coinciden exactamente: ${sample.gameId}, ply ${sample.ply}, perspectiva ${sample.perspective}.`,
      );
    const next = neural.encodeNeuralFeatures(state, sample.perspective, game.rules, schema);
    validateSparseFeatures(next, neural.NEURAL_INPUT_SIZE_V2);
    if (!same(next.slice(0, previous.length), previous) || next.length !== previous.length + 3)
      throw new Error(
        'El codificador V2 no conserva exactamente el prefijo V1 y sus tres entradas nuevas.',
      );
    converted.set(sample, { ...sample, features: next });
  }
  const featureTransform = {
    format: 'hex-feature-transform-v1',
    operation: 'verified-replay-v1-to-v2-without-search',
    fromSchema: header.schema,
    fromInputSize: header.inputSize,
    toSchema: schema,
    toInputSize: neural.NEURAL_INPUT_SIZE_V2,
    inputRowsSha256: digest(canonicalJson(rows)),
    positions: pairs.size,
    samples: samples.length,
    games: games.size,
    teacherLabelsAndProvenancePreserved: true,
    fingerprintScope:
      'Existing sample fingerprint fields retain the original teacher V1 identity; they are not hashes of the transformed V2 features.',
    ...(header.featureTransform === undefined
      ? {}
      : { previousFeatureTransform: header.featureTransform }),
  };
  return rows.map((row, index) =>
    index === 0
      ? { ...header, schema, inputSize: neural.NEURAL_INPUT_SIZE_V2, featureTransform }
      : (converted.get(row) ?? row),
  );
}

async function codeHashes() {
  return Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (path) => [path, digest(await readFile(resolve(root, path)))]),
    ),
  );
}

const comparablePath = (path) =>
  process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);

export async function runReencode(options, dependencies = {}) {
  const input = resolve(options.input);
  const output = resolve(options.output);
  const reportPath = options.report ? resolve(options.report) : null;
  const paths = [input, output, ...(reportPath ? [reportPath] : [])].map(comparablePath);
  if (new Set(paths).size !== paths.length)
    throw new Error('Entrada, salida e informe deben tener rutas distintas.');
  const inputBefore = await readFile(input);
  const sourcesBefore = await codeHashes();
  let modules;
  let outputHandle;
  let reportHandle;
  let wroteOutput = false;
  try {
    modules = dependencies.modules ?? (await loadGameModules());
    const rows = inputBefore
      .toString('utf8')
      .trim()
      .split(/\r?\n/)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          throw new Error(`JSONL inválido en la línea ${index + 1}.`);
        }
      });
    const schema = options.schema ?? modules.neural.NEURAL_FEATURE_SCHEMA_V2;
    const converted = reencodeRows(rows, schema, modules);
    const inputAfter = await readFile(input);
    const sourcesAfter = await codeHashes();
    if (digest(inputBefore) !== digest(inputAfter) || !same(sourcesBefore, sourcesAfter))
      throw new Error('La entrada o las fuentes cambiaron durante la recodificación.');
    // Teacher sourceHashes stay untouched; current encoder/replay provenance has a separate scope.
    converted[0].featureTransform = {
      ...converted[0].featureTransform,
      inputDataset: { path: input, sha256: digest(inputBefore) },
      encoderSourceHashes: sourcesBefore,
      verification: {
        inputSha256Before: digest(inputBefore),
        inputSha256After: digest(inputAfter),
        sourceHashesBeforeSha256: digest(canonicalJson(sourcesBefore)),
        sourceHashesAfterSha256: digest(canonicalJson(sourcesAfter)),
      },
    };
    const bytes = `${converted.map((row) => JSON.stringify(row)).join('\n')}\n`;
    await mkdir(dirname(output), { recursive: true });
    if (reportPath) await mkdir(dirname(reportPath), { recursive: true });
    outputHandle = await open(output, 'wx');
    if (reportPath) reportHandle = await open(reportPath, 'wx');
    await outputHandle.writeFile(bytes);
    wroteOutput = true;
    const inputFinal = await readFile(input);
    const sourcesFinal = await codeHashes();
    const report = {
      format: 'hex-reencode-report-v1',
      status:
        digest(inputFinal) === digest(inputBefore) && same(sourcesFinal, sourcesBefore)
          ? 'complete'
          : 'incomplete',
      createdAt: new Date().toISOString(),
      input: { path: input, sha256Before: digest(inputBefore), sha256After: digest(inputFinal) },
      output: { path: output, sha256: digest(bytes) },
      schema,
      inputSize: modules.neural.NEURAL_INPUT_SIZE_V2,
      samples: converted[0].featureTransform.samples,
      positions: converted[0].featureTransform.positions,
      games: converted[0].featureTransform.games,
      encoderSourceHashesBefore: sourcesBefore,
      encoderSourceHashesAfter: sourcesFinal,
      teacherSourceHashesPreserved: same(rows[0].sourceHashes, converted[0].sourceHashes),
      searchRepeated: false,
      published: false,
    };
    if (reportHandle) await reportHandle.writeFile(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== 'complete')
      throw new Error(
        'La entrada o las fuentes cambiaron al guardar; el informe marca salida incompleta.',
      );
    return report;
  } finally {
    await outputHandle?.close();
    await reportHandle?.close();
    // If reserving the optional report failed, remove only our newly created, still empty output.
    if (outputHandle && !wroteOutput) await unlink(output);
    if (!dependencies.modules) await modules?.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2), {
    input: { type: 'string', required: true },
    output: { type: 'string', required: true },
    schema: { type: 'string', default: 'hex-sparse-v2' },
    report: { type: 'string' },
    help: { type: 'boolean', default: false },
  });
  if (options.help) {
    console.log(
      'pnpm exec node scripts/ai/reencode.mjs --input teacher-v1.jsonl --output teacher-v2.jsonl [--schema hex-sparse-v2] [--report report.json]\nReproduce y verifica todas las muestras; conserva etiquetas y fuente del profesor. No repite búsquedas, descarta muestras, reanuda ni sobrescribe salidas existentes.',
    );
    return;
  }
  const report = await runReencode(options);
  console.log(
    `Recodificación ${report.status}: ${report.samples} muestras (${report.positions} posiciones), sin repetir búsqueda. Salida: ${report.output.path}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
