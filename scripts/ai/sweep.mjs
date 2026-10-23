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

/** Cancellation arrives only through the private inherited parent channel. */
export function sweepCancellation(channel = process) {
  let requested = false;
  const receive = (message) => {
    if (message?.type !== 'hex-ai-stop') return;
    requested = true;
    // While training, trainChild owns a SIGTERM listener and the exact Python
    // handle. Between jobs this flag prevents another child from starting.
    channel.emit('SIGTERM');
  };
  channel.on('message', receive);
  return {
    check() {
      if (!requested) return;
      const error = new Error('Barrido cancelado por su supervisor; reanuda con --resume.');
      error.sweepStatus = 'interrupted';
      throw error;
    },
    dispose() {
      channel.removeListener('message', receive);
    },
  };
}

export function sweepOptions(argv) {
  const options = parseArguments(argv, {
    input: { type: 'string', required: true },
    model: { type: 'string', default: 'src/ai-models/hex-value.bin' },
    directory: { type: 'string', required: true },
    'learning-rates': { type: 'string', default: '0.00005,0.0002' },
    losses: { type: 'string', default: 'mse,huber' },
    seeds: { type: 'number', default: 3, integer: true, min: 1, max: 100 },
    seed: { type: 'number', default: 20261023, integer: true, min: 0, max: 4294967295 },
    'batch-size': { type: 'number', default: 64, integer: true, min: 2, max: 65536 },
    epochs: { type: 'number', default: 80, integer: true, min: 1, max: 10000 },
    patience: { type: 'number', default: 12, integer: true, min: 1 },
    'weight-decay': { type: 'number', default: 0.001, min: 0, max: 1 },
    'huber-delta': { type: 'number', default: 0.1, min: 0.000001, max: 10 },
    'sample-weighting': { type: 'string', default: 'none' },
    'confidence-scale': { type: 'number', default: 500, min: 0.000001, max: 1000000 },
    'split-group-field': { type: 'string', default: 'gameId' },
    'max-training-games': { type: 'number', integer: true, min: 1 },
    'max-runtime-minutes': { type: 'number', default: 60, min: 0.001, max: 10080 },
    resume: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (!options.help) sweepVariants(options);
  return options;
}

export function sweepVariants(options) {
  const rates = options['learning-rates'].split(',').map(Number);
  const losses = options.losses.split(',');
  if (
    new Set(rates).size !== rates.length ||
    rates.some((rate) => !Number.isFinite(rate) || rate <= 0 || rate > 1)
  )
    throw new Error('--learning-rates necesita tasas positivas finitas sin duplicados.');
  if (
    new Set(losses).size !== losses.length ||
    losses.some((loss) => !['mse', 'huber'].includes(loss))
  )
    throw new Error('--losses admite mse,huber sin duplicados.');
  if (
    !Number.isSafeInteger(options['batch-size']) ||
    options['batch-size'] < 2 ||
    options['batch-size'] % 2
  )
    throw new Error('--batch-size debe ser par para mantener las perspectivas juntas.');
  if (!['none', 'teacher-stability'].includes(options['sample-weighting']))
    throw new Error('--sample-weighting debe ser none o teacher-stability.');
  if (!['gameId', 'familyId'].includes(options['split-group-field']))
    throw new Error('--split-group-field debe ser gameId o familyId.');
  const variants = [];
  for (const learningRate of rates) {
    for (const loss of losses) {
      for (let index = 0; index < options.seeds; index += 1) {
        variants.push({
          id: `${loss}-lr-${String(learningRate).replaceAll('.', 'p')}-seed-${index + 1}`,
          learningRate,
          loss,
          seed: experimentSeed(options.seed, index, 'sweep-training'),
        });
      }
    }
  }
  return variants;
}

function trainChild(args, timeoutMs) {
  return new Promise((accept, reject) => {
    const child = spawn(
      process.env.AI_PYTHON || 'python',
      ['-B', resolve(root, 'scripts/ai/train.py'), ...args.map(String)],
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
    }, timeoutMs);
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
        const error = new Error(
          `Entrenamiento ${reason || `salida ${code}`}; reanuda con --resume.`,
        );
        error.sweepStatus = reason || 'failed';
        reject(error);
      }
    });
  });
}

/** Development-only matrix on a copied dataset. It does not select or publish a champion. */
export async function runSweep(options, dependencies = {}) {
  const variants = sweepVariants(options);
  const directory = resolve(options.directory);
  const parts = relative(root, directory).split(/[\\/]/);
  if (parts[0] !== '.ai-lab' || parts.length < 2)
    throw new Error('--directory debe estar dentro de .ai-lab del proyecto.');
  await mkdir(directory, { recursive: true });
  const release = await acquireResearchLock(resolve(directory, 'run.lock'), options.resume);
  const checkpoint = resolve(directory, 'progress.json');
  const input = resolve(options.input);
  const initialModel = resolve(options.model);
  const dataset = resolve(directory, 'positions.jsonl');
  const champion = resolve(directory, 'champion.bin');
  const { resume: _resume, 'max-runtime-minutes': _budget, ...settings } = options;
  void _resume;
  void _budget;
  const startedAt = Date.now();
  const deadline = startedAt + options['max-runtime-minutes'] * 60000;
  const fingerprint = dependencies.fingerprint ?? (() => researchFingerprint(root));
  const train = dependencies.train ?? trainChild;
  const cancellation = sweepCancellation();
  let state;
  try {
    cancellation.check();
    const identity = {
      settings,
      sources: await fingerprint(),
      inputSha256: await fileDigest(input),
      initialModelSha256: await fileDigest(initialModel),
    };
    if (existsSync(checkpoint)) {
      if (!options.resume) throw new Error('Ya hay un experimento; usa --resume.');
      const previous = await readJson(checkpoint);
      if (JSON.stringify(previous.identity) !== JSON.stringify(identity))
        throw new Error('Han cambiado fuentes, datos, modelo o parámetros; utiliza otra carpeta.');
      state = previous;
    } else {
      if (existsSync(dataset) || existsSync(champion))
        throw new Error('Hay artefactos sin manifiesto; utiliza otra carpeta.');
      await copyFile(input, dataset);
      await copyFile(initialModel, champion);
      state = {
        format: 'hex-neural-sweep-v1',
        identity,
        createdAt: new Date().toISOString(),
        status: 'running',
        variants,
        completed: {},
        elapsedMs: 0,
        published: false,
        promotionAllowed: false,
        selectionMetric: 'unweighted-validation-mse',
        interpretation:
          'Barrido de desarrollo. Elegir parámetros con esta validación requiere una confirmación posterior con datos y aperturas nuevas.',
      };
      await writeJsonCheckpoint(checkpoint, state);
    }
    const verify = async () => {
      if ((await fingerprint()) !== identity.sources)
        throw new Error('Las fuentes han cambiado durante el barrido.');
      for (const [path, expected] of [
        [input, identity.inputSha256],
        [dataset, identity.inputSha256],
        [initialModel, identity.initialModelSha256],
        [champion, identity.initialModelSha256],
      ]) {
        if ((await fileDigest(path)) !== expected)
          throw new Error(`Artefacto de entrada modificado: ${path}`);
      }
      for (const completed of Object.values(state.completed)) {
        for (const [path, expected] of Object.entries(completed.artifacts)) {
          if ((await fileDigest(path)) !== expected)
            throw new Error(`Artefacto terminado modificado: ${path}`);
        }
      }
    };
    await verify();
    for (const variant of variants) {
      cancellation.check();
      if (state.completed[variant.id]) continue;
      await verify();
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        const error = new Error('Presupuesto agotado; reanuda con --resume.');
        error.sweepStatus = 'budget-exhausted';
        throw error;
      }
      state.status = 'running';
      state.currentVariant = variant.id;
      delete state.error;
      await writeJsonCheckpoint(checkpoint, state);
      const model = resolve(directory, `${variant.id}.bin`);
      console.log(`Barrido: ${variant.id}.`);
      // An IPC stop can arrive while hashes/checkpoints above are being read.
      // Do not launch a Python worker after that cancellation was observed.
      cancellation.check();
      await train(
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
          options['batch-size'],
          '--seed',
          variant.seed,
          '--split-seed',
          experimentSeed(options.seed, 0, 'sweep-validation'),
          '--split-policy',
          'hash-threshold',
          '--split-group-field',
          options['split-group-field'],
          '--teacher-weight',
          1,
          '--antisymmetric',
          '--learning-rate',
          variant.learningRate,
          '--weight-decay',
          options['weight-decay'],
          '--loss',
          variant.loss,
          '--huber-delta',
          options['huber-delta'],
          '--sample-weighting',
          options['sample-weighting'],
          '--confidence-scale',
          options['confidence-scale'],
          ...(options['max-training-games']
            ? ['--max-training-games', options['max-training-games']]
            : []),
        ],
        remaining,
      );
      cancellation.check();
      await verify();
      const training = await readJson(`${model}.training.json`);
      if (!Number.isFinite(training.loss?.validation))
        throw new Error('Informe sin MSE de validación finita.');
      const artifacts = {};
      for (const path of [model, `${model}.training.json`, `${model}.parity.json`])
        artifacts[path] = await fileDigest(path);
      state.completed[variant.id] = {
        ...variant,
        model,
        artifacts,
        bestEpoch: training.bestEpoch,
        loss: training.loss,
        split: training.split,
        sampleWeighting: training.sampleWeighting,
        finishedAt: new Date().toISOString(),
      };
      await writeJsonCheckpoint(checkpoint, state);
    }
    await verify();
    cancellation.check();
    state.status = 'complete';
    state.finishedAt = new Date().toISOString();
    delete state.error;
    return state;
  } catch (error) {
    if (state) {
      state.status = error.sweepStatus || 'failed';
      state.error = error.message;
    }
    throw error;
  } finally {
    try {
      cancellation.dispose();
      if (state) {
        state.elapsedMs += Date.now() - startedAt;
        await writeJsonCheckpoint(checkpoint, state);
      }
    } finally {
      await release();
    }
  }
}

async function main() {
  const options = sweepOptions(process.argv.slice(2));
  if (options.help) {
    console.log(
      'pnpm exec node scripts/ai/sweep.mjs --input dataset.jsonl --directory .ai-lab/sweep-nuevo [--model campeón.bin] [--learning-rates 0.00005,0.0002] [--losses mse,huber] [--seeds 3] [--batch-size 64] [--epochs 80] [--split-group-field familyId] [--sample-weighting teacher-stability] [--max-runtime-minutes 60] [--resume]\nCongela datos y campeón; conserva resultados verificados; no publica pesos.',
    );
    return;
  }
  const state = await runSweep(options);
  console.log(
    `Barrido ${state.status}: ${Object.keys(state.completed).length} variantes. ${resolve(options.directory, 'progress.json')}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => {
      if (process.connected) process.disconnect();
    });
}
