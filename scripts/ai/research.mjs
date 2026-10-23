import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArguments, writeJsonCheckpoint } from './shared.mjs';
import { experimentSeed } from './selfplay-policy.mjs';
import { acquireResearchLock, fileDigest, researchFingerprint } from './research-state.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

export function researchVariants(options) {
  const losses = options.losses.split(',');
  const sizes = options['training-games'].split(',').map(Number);
  if (
    new Set(losses).size !== losses.length ||
    losses.some((loss) => !['mse', 'huber'].includes(loss))
  )
    throw new Error('--losses admite mse,huber sin duplicados.');
  if (
    new Set(sizes).size !== sizes.length ||
    sizes.some((size) => !Number.isSafeInteger(size) || size < 0)
  )
    throw new Error(
      '--training-games necesita tamaños enteros sin duplicados; 0 usa todas las partidas.',
    );
  const variants = [];
  for (const loss of losses) {
    for (const size of sizes) {
      for (let index = 0; index < options.seeds; index += 1) {
        variants.push({
          id: `${loss}-games-${size || 'all'}-seed-${index + 1}`,
          loss,
          maximumTrainingGames: size || null,
          seed: experimentSeed(options.seed, index, 'research-training'),
        });
      }
    }
  }
  return variants;
}

function runChild(script, args, milliseconds, python = false) {
  return new Promise((accept, reject) => {
    const child = spawn(
      python ? process.env.AI_PYTHON || 'python' : process.execPath,
      python
        ? ['-B', resolve(root, 'scripts/ai/train.py'), ...args.map(String)]
        : [resolve(root, 'scripts/ai', script), ...args.map(String)],
      {
        cwd: root,
        stdio: 'inherit',
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          OPENBLAS_NUM_THREADS: process.env.OPENBLAS_NUM_THREADS || '1',
        },
      },
    );
    let reason;
    const stop = () => {
      reason = 'interrupted';
      child.kill();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const timer = setTimeout(() => {
      reason = 'budget-exhausted';
      child.kill();
    }, milliseconds);
    const cleanup = () => {
      clearTimeout(timer);
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    };
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('exit', (code) => {
      cleanup();
      if (!reason && code === 0) accept();
      else {
        const error = new Error(`${script}: ${reason || `salida ${code}`}. Reanuda con --resume.`);
        error.researchStatus = reason || 'failed';
        reject(error);
      }
    });
  });
}

export async function runResearch(options) {
  if ((options['batch-size'] ?? 128) % 2)
    throw new Error('--batch-size debe ser par para conservar las perspectivas juntas.');
  const variants = researchVariants(options);
  const directory = resolve(options.directory);
  const directoryParts = relative(root, directory).split(/[\\/]/);
  if (directoryParts[0] !== '.ai-lab' || directoryParts.length < 2)
    throw new Error('--directory debe ser una carpeta nueva dentro de .ai-lab del proyecto.');
  await mkdir(directory, { recursive: true });
  const release = await acquireResearchLock(resolve(directory, 'run.lock'), options.resume);
  const checkpoint = resolve(directory, 'progress.json');
  const startedAt = Date.now();
  const deadline = startedAt + options['max-runtime-minutes'] * 60_000;
  const { resume: _resume, ...settings } = options;
  void _resume;
  const input = resolve(options.input);
  const champion = resolve(directory, 'champion.bin');
  const dataset = resolve(directory, 'positions.jsonl');
  let state;
  try {
    const fingerprint = await researchFingerprint(root);
    const identity = {
      settings,
      sources: fingerprint,
      inputSha256: await fileDigest(input),
      initialModelSha256: await fileDigest(resolve(options.model)),
    };
    if (existsSync(checkpoint)) {
      if (!options.resume) throw new Error('La carpeta ya contiene un experimento; usa --resume.');
      state = await readJson(checkpoint);
      if (JSON.stringify(state.identity) !== JSON.stringify(identity)) {
        state = undefined;
        throw new Error(
          'Han cambiado código, datos, modelo o parámetros. Usa otra carpeta para otro experimento.',
        );
      }
    } else {
      if (existsSync(champion) || existsSync(dataset))
        throw new Error('Hay artefactos sin manifiesto; utiliza otra carpeta.');
      state = {
        format: 'hex-neural-research-v1',
        createdAt: new Date().toISOString(),
        identity,
        status: 'running',
        stages: {},
        variants,
        promotionAllowed: false,
        interpretation:
          'Piloto de desarrollo. La validación puede compartir procedencia con el modelo inicial; el banco público no es un examen independiente ni una medida de Elo.',
      };
      await copyFile(resolve(options.model), champion);
      await writeJsonCheckpoint(checkpoint, state);
    }
    if ((await fileDigest(champion)) !== identity.initialModelSha256)
      throw new Error('El campeón congelado ha cambiado.');
    const assertSources = async () => {
      if ((await researchFingerprint(root)) !== fingerprint)
        throw new Error(
          'Las fuentes han cambiado durante el experimento; se invalida esta ejecución.',
        );
      if ((await fileDigest(input)) !== identity.inputSha256)
        throw new Error('Los datos de entrada han cambiado durante el experimento.');
      if ((await fileDigest(champion)) !== identity.initialModelSha256)
        throw new Error('El campeón congelado ha cambiado durante el experimento.');
      for (const previous of Object.values(state.stages)) {
        if (previous.status !== 'complete') continue;
        for (const [path, expected] of Object.entries(previous.artifacts)) {
          if ((await fileDigest(path)) !== expected)
            throw new Error(`Artefacto de una etapa anterior modificado: ${path}`);
        }
      }
    };
    const stage = async (id, script, args, artifacts, python = false) => {
      await assertSources();
      const previous = state.stages[id];
      if (previous?.status === 'complete') {
        for (const [path, digest] of Object.entries(previous.artifacts)) {
          if ((await fileDigest(path)) !== digest) throw new Error(`Artefacto modificado: ${path}`);
        }
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        const error = new Error('Presupuesto de tiempo agotado. Reanuda con --resume.');
        error.researchStatus = 'budget-exhausted';
        throw error;
      }
      state.status = 'running';
      state.stage = id;
      state.stages[id] = { status: 'running', startedAt: new Date().toISOString() };
      delete state.error;
      await writeJsonCheckpoint(checkpoint, state);
      console.log(`Investigación: ${id}.`);
      await runChild(script, args, remaining, python);
      await assertSources();
      const hashes = {};
      for (const path of artifacts) hashes[path] = await fileDigest(path);
      state.stages[id] = {
        status: 'complete',
        artifacts: hashes,
        finishedAt: new Date().toISOString(),
      };
      await writeJsonCheckpoint(checkpoint, state);
    };
    await stage(
      'reanálisis',
      'reanalyze.mjs',
      [
        '--input',
        input,
        '--output',
        dataset,
        '--positions',
        options.positions,
        '--positions-per-game',
        options['positions-per-game'],
        '--budget-ms',
        options['teacher-budget-ms'],
        '--probe-budget-ms',
        options['probe-budget-ms'],
        '--depth',
        options['teacher-depth'],
        '--minimum-depth',
        options['minimum-depth'],
        '--seed',
        options.seed,
        ...(existsSync(`${dataset}.report.json`) ? ['--resume'] : []),
      ],
      [dataset, `${dataset}.report.json`],
    );
    const summary = [];
    for (const variant of variants) {
      const model = resolve(directory, `${variant.id}.bin`);
      const benchmark = resolve(directory, `${variant.id}.benchmark.json`);
      await stage(
        `entrenamiento-${variant.id}`,
        'train.py',
        [
          '--input',
          dataset,
          '--output',
          model,
          '--initialize-model',
          champion,
          '--epochs',
          options.epochs,
          '--patience',
          options.patience,
          '--batch-size',
          options['batch-size'] ?? 128,
          '--seed',
          variant.seed,
          '--split-seed',
          experimentSeed(options.seed, 0, 'research-validation'),
          '--split-policy',
          'hash-threshold',
          '--split-group-field',
          options['split-group-field'] ?? 'gameId',
          '--teacher-weight',
          1,
          '--antisymmetric',
          '--learning-rate',
          options['learning-rate'],
          '--weight-decay',
          options['weight-decay'],
          '--loss',
          variant.loss,
          '--huber-delta',
          options['huber-delta'],
          '--sample-weighting',
          options['sample-weighting'] ?? 'none',
          '--confidence-scale',
          options['confidence-scale'] ?? 500,
          ...(variant.maximumTrainingGames
            ? ['--max-training-games', variant.maximumTrainingGames]
            : []),
        ],
        [model, `${model}.training.json`, `${model}.parity.json`],
        true,
      );
      await stage(
        `banco-${variant.id}`,
        'benchmark.mjs',
        [
          '--output',
          benchmark,
          '--model',
          model,
          '--champion',
          champion,
          '--budget-ms',
          options['benchmark-ms'],
          '--depth',
          options['benchmark-depth'],
          '--limit',
          options['benchmark-limit'],
          '--partition',
          'development',
          '--seed',
          experimentSeed(options.seed, 0, 'research-benchmark'),
        ],
        [benchmark],
      );
      const training = await readJson(`${model}.training.json`);
      summary.push({
        ...variant,
        model,
        benchmark,
        samples: training.samples,
        bestEpoch: training.bestEpoch,
        loss: training.loss,
        featureConflicts: training.featureConflicts,
        generalizationProven: false,
      });
    }
    await assertSources();
    const report = {
      format: 'hex-neural-research-summary-v1',
      variants: summary,
      settings,
      elapsedMs: Date.now() - startedAt,
      promotionAllowed: false,
      nextGate:
        'Revisar errores por familia, repetir con datos nuevos y confirmar en torneos pareados reservados a 15 s. El piloto no demuestra mejora de fuerza.',
    };
    await writeJsonCheckpoint(resolve(directory, 'summary.json'), report);
    state.status = 'complete';
    state.finishedAt = new Date().toISOString();
    delete state.error;
    await writeJsonCheckpoint(checkpoint, state);
    console.log(`Piloto terminado: ${resolve(directory, 'summary.json')}. No se publican pesos.`);
    return report;
  } catch (error) {
    if (state) {
      state.status = error.researchStatus || 'failed';
      state.error = error.message;
      await writeJsonCheckpoint(checkpoint, state);
    }
    throw error;
  } finally {
    await release();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2), {
    input: { type: 'string', required: true },
    directory: { type: 'string', required: true },
    model: { type: 'string', default: 'src/ai-models/hex-value.bin' },
    positions: { type: 'number', default: 32, integer: true, min: 4 },
    'positions-per-game': { type: 'number', default: 2, integer: true, min: 1 },
    'teacher-budget-ms': { type: 'number', default: 3000, integer: true, min: 20, max: 120000 },
    'probe-budget-ms': { type: 'number', default: 1000, integer: true, min: 0, max: 120000 },
    'teacher-depth': { type: 'number', default: 9, integer: true, min: 1, max: 12 },
    'minimum-depth': { type: 'number', default: 2, integer: true, min: 1, max: 12 },
    seeds: { type: 'number', default: 2, integer: true, min: 1, max: 100 },
    seed: { type: 'number', default: 20261023, integer: true, min: 0, max: 4294967295 },
    losses: { type: 'string', default: 'mse,huber' },
    'training-games': { type: 'string', default: '0' },
    epochs: { type: 'number', default: 20, integer: true, min: 1, max: 10000 },
    patience: { type: 'number', default: 6, integer: true, min: 1 },
    'batch-size': { type: 'number', default: 128, integer: true, min: 2, max: 65536 },
    'split-group-field': { type: 'string', default: 'gameId' },
    'learning-rate': { type: 'number', default: 0.0002, min: 0.000001, max: 1 },
    'weight-decay': { type: 'number', default: 0.001, min: 0, max: 1 },
    'huber-delta': { type: 'number', default: 0.1, min: 0.000001, max: 10 },
    'sample-weighting': { type: 'string', default: 'none' },
    'confidence-scale': { type: 'number', default: 500, min: 0.000001, max: 1000000 },
    'benchmark-ms': { type: 'number', default: 500, integer: true, min: 20, max: 120000 },
    'benchmark-depth': { type: 'number', default: 3, integer: true, min: 1, max: 12 },
    'benchmark-limit': { type: 'number', default: 12, integer: true, min: 1 },
    'max-runtime-minutes': { type: 'number', default: 15, min: 0.01, max: 10080 },
    resume: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (options.help) {
    console.log(`Piloto reproducible sin publicación:
pnpm ai:research --input dataset.jsonl --directory .ai-lab/research-nuevo
Compara MSE/Huber y varias semillas; --training-games 8,16,0 añade curvas por partidas.
--max-runtime-minutes limita cada ejecución. --resume conserva etapas verificadas por hashes.
El banco público es de desarrollo: confirmar fuerza exige datos y torneos independientes.`);
    return;
  }
  await runResearch(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
