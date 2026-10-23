import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson } from './research-data.mjs';
import { acquireResearchLock, fileDigest } from './research-state.mjs';
import { parseArguments, writeJsonCheckpoint } from './shared.mjs';
import { experimentSeed } from './selfplay-policy.mjs';
import {
  freezeCampaignRuntime,
  mergeCampaignLabels,
  shardCampaignGames,
  verifyCampaignRuntime,
} from './campaign-data.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const jsonl = (text) => text.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);

/** Only the exact process tree started by this supervisor is eligible for termination. */
export async function stopCampaignChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (child.managesDescendants === false) {
    child.kill('SIGTERM');
    return;
  }
  if (child.connected && typeof child.send === 'function') {
    const stopped = await new Promise((accept) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener('close', onClose);
        accept(result);
      };
      const onClose = () => finish(true);
      const timer = setTimeout(() => finish(false), 5000);
      child.once('close', onClose);
      if (child.exitCode !== null || child.signalCode !== null) finish(true);
      else {
        // A private inherited IPC channel lets the worker terminate its exact
        // Python handle before exiting, even when Windows denies tree queries.
        child.send({ type: 'hex-ai-stop' }, () => {});
      }
    });
    if (stopped) return;
  }
  if (process.platform !== 'win32')
    throw new Error(`El árbol propio ${child.pid} no confirmó su detención cooperativa.`);
  await new Promise((accept, reject) => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('error', reject);
    killer.once('exit', (code) =>
      code === 0 || child.exitCode !== null || child.signalCode !== null
        ? accept()
        : reject(new Error(`No se pudo detener el árbol propio ${child.pid}.`)),
    );
  });
}

export function campaignOptions(argv) {
  const options = parseArguments(argv, {
    input: { type: 'string', required: true },
    directory: { type: 'string', required: true },
    workers: { type: 'number', default: 4, integer: true, min: 1, max: 12 },
    positions: { type: 'number', default: 2048, integer: true, min: 4, max: 1000000 },
    'positions-per-game': { type: 'number', default: 24, integer: true, min: 1, max: 10000 },
    'budget-ms': { type: 'number', default: 5000, integer: true, min: 20, max: 120000 },
    'probe-budget-ms': { type: 'number', default: 1000, integer: true, min: 0, max: 120000 },
    depth: { type: 'number', default: 9, integer: true, min: 1, max: 12 },
    'minimum-depth': { type: 'number', default: 3, integer: true, min: 1, max: 12 },
    seed: { type: 'number', default: 20261023, integer: true, min: 0, max: 4294967295 },
    epochs: { type: 'number', default: 80, integer: true, min: 1, max: 10000 },
    seeds: { type: 'number', default: 3, integer: true, min: 1, max: 100 },
    'learning-rates': { type: 'string', default: '0.00005,0.0002' },
    losses: { type: 'string', default: 'mse,huber' },
    'batch-size': { type: 'number', default: 64, integer: true, min: 2, max: 65536 },
    'sample-weighting': { type: 'string', default: 'none' },
    'max-runtime-minutes': { type: 'number', default: 720, min: 0.01, max: 10080 },
    'benchmark-ms': { type: 'number', default: 1500, integer: true, min: 20, max: 120000 },
    'benchmark-depth': { type: 'number', default: 5, integer: true, min: 1, max: 12 },
    finalists: { type: 'number', default: 3, integer: true, min: 1, max: 100 },
    resume: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (!options.help && options['minimum-depth'] > options.depth)
    throw new Error('La profundidad mínima supera la máxima.');
  return options;
}

/** Long jobs run against an immutable local snapshot, with no publication side effect. */
export async function runCampaign(options) {
  const directory = resolve(options.directory);
  const parts = relative(root, directory).split(/[\\/]/);
  if (parts[0] !== '.ai-lab' || parts.length < 2)
    throw new Error('La campaña debe guardarse dentro de .ai-lab.');
  await mkdir(directory, { recursive: true });
  const release = await acquireResearchLock(resolve(directory, 'run.lock'), options.resume);
  const checkpoint = resolve(directory, 'progress.json');
  const { resume: _resume, 'max-runtime-minutes': _budget, ...settings } = options;
  void _resume;
  void _budget;
  const deadline = Date.now() + options['max-runtime-minutes'] * 60000;
  const children = new Set();
  const completions = new Set();
  const stop = () => {
    for (const child of children)
      void stopCampaignChild(child).catch((error) => console.error(error.message));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let state;
  let writes = Promise.resolve();
  const save = () => {
    const snapshot = structuredClone(state);
    writes = writes.then(() => writeJsonCheckpoint(checkpoint, snapshot));
    return writes;
  };
  try {
    if (jsonl(await readFile(resolve(options.input), 'utf8'))[0]?.sourceRole !== 'development')
      throw new Error(
        'La entrada debe declarar sourceRole: development; las trayectorias reservadas no se usan para entrenar.',
      );
    const identity = {
      settings,
      inputSha256: await fileDigest(resolve(options.input)),
      driver: await fileDigest(fileURLToPath(import.meta.url)),
      dataHelpers: await fileDigest(resolve(root, 'scripts/ai/campaign-data.mjs')),
    };
    if (existsSync(checkpoint)) {
      if (!options.resume) throw new Error('La campaña ya existe; utiliza --resume.');
      state = await json(checkpoint);
      if (canonicalJson(state.identity) !== canonicalJson(identity)) {
        state = undefined;
        throw new Error('Los datos, parámetros o el coordinador cambiaron; utiliza otra campaña.');
      }
    } else {
      state = {
        format: 'hex-neural-campaign-v1',
        identity,
        createdAt: new Date().toISOString(),
        status: 'preparing',
        stages: {},
        published: false,
      };
      await save();
    }
    if (!state.runtime) {
      const destination = resolve(directory, `runtime-${Date.now()}`);
      const snapshot = await freezeCampaignRuntime(root, destination);
      state.runtime = destination;
      state.runtimeSha256 = snapshot.sha256;
      const copiedInput = resolve(directory, 'source-trajectories.jsonl');
      await copyFile(resolve(options.input), copiedInput);
      state.input = copiedInput;
      await save();
    }
    const verify = async () => {
      const manifest = await verifyCampaignRuntime(state.runtime);
      if (manifest.sha256 !== state.runtimeSha256)
        throw new Error('Cambió el manifiesto congelado.');
      if ((await fileDigest(state.input)) !== identity.inputSha256)
        throw new Error('Cambió la copia de trayectorias.');
      for (const stage of Object.values(state.stages)) {
        if (stage.status !== 'complete') continue;
        for (const [path, hash] of Object.entries(stage.artifacts)) {
          if ((await fileDigest(path)) !== hash)
            throw new Error(`Artefacto terminado modificado: ${path}`);
        }
      }
    };
    const stage = async (id, script, args, outputs) => {
      await verify();
      if (state.stages[id]?.status === 'complete') return;
      const priorPid = state.stages[id]?.pid;
      if (priorPid) {
        try {
          process.kill(priorPid, 0);
          throw new Error(`El proceso de ${id} sigue activo (PID ${priorPid}); no se duplica.`);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Presupuesto agotado; reanuda la misma campaña.');
      const logPath = resolve(directory, `${id}.log`);
      const log = await open(logPath, 'a');
      const child = spawn(
        process.execPath,
        [resolve(state.runtime, 'scripts/ai', script), ...args.map(String)],
        {
          cwd: state.runtime,
          stdio:
            script === 'sweep.mjs' ? ['ignore', log.fd, log.fd, 'ipc'] : ['ignore', log.fd, log.fd],
          env: { ...process.env, PYTHONUTF8: '1', OPENBLAS_NUM_THREADS: '1' },
        },
      );
      child.managesDescendants = script === 'sweep.mjs';
      children.add(child);
      const completion = new Promise((accept, reject) => {
        const timer = setTimeout(() => {
          void stopCampaignChild(child).catch(reject);
        }, remaining);
        let closed = false;
        const cleanup = async () => {
          if (closed) return;
          closed = true;
          clearTimeout(timer);
          children.delete(child);
          await log.close();
        };
        child.once('error', async (error) => {
          await cleanup();
          reject(error);
        });
        child.once('exit', async (code) => {
          await cleanup();
          if (code === 0) accept();
          else reject(new Error(`${id} terminó con código ${code}; consulta ${logPath}.`));
        });
      });
      completions.add(completion);
      void completion.catch(() => {});
      try {
        state.status = 'running';
        state.stages[id] = {
          status: 'running',
          pid: child.pid,
          log: logPath,
          startedAt: new Date().toISOString(),
        };
        await save();
        console.log(`Campaña: ${id}; PID ${child.pid}; ${logPath}`);
        await completion;
      } finally {
        if (children.has(child)) await stopCampaignChild(child);
        await completion.catch(() => {});
        completions.delete(completion);
      }
      const artifacts = {};
      for (const path of outputs) artifacts[path] = await fileDigest(path);
      state.stages[id] = {
        ...state.stages[id],
        status: 'complete',
        artifacts,
        finishedAt: new Date().toISOString(),
      };
      await save();
      await verify();
      console.log(`Campaña: ${id} terminado.`);
    };
    await verify();
    const shards = shardCampaignGames(
      await readFile(state.input, 'utf8'),
      options.workers,
      options.seed,
    ).filter((rows) => rows.length > 1);
    const outputs = [];
    const jobs = [];
    for (const [index, rows] of shards.entries()) {
      const source = resolve(directory, `trajectories-${index}.jsonl`);
      const output = resolve(directory, `labels-${index}.jsonl`);
      if (!existsSync(source))
        await writeFile(source, rows.map(JSON.stringify).join('\n') + '\n', { flag: 'wx' });
      else if ((await readFile(source, 'utf8')) !== rows.map(JSON.stringify).join('\n') + '\n')
        throw new Error(`La partición ${index} ha cambiado.`);
      outputs.push(output);
      jobs.push(() =>
        stage(
          `teacher-${index}`,
          'reanalyze.mjs',
          [
            '--input',
            source,
            '--output',
            output,
            '--positions',
            Math.ceil(options.positions / shards.length),
            '--positions-per-game',
            options['positions-per-game'],
            '--budget-ms',
            options['budget-ms'],
            '--probe-budget-ms',
            options['probe-budget-ms'],
            '--depth',
            options.depth,
            '--minimum-depth',
            options['minimum-depth'],
            '--seed',
            experimentSeed(options.seed, index, 'campaign-teacher'),
            ...(existsSync(`${output}.report.json`) ? ['--resume'] : []),
          ],
          [output, `${output}.report.json`],
        ),
      );
    }
    const results = await Promise.allSettled(jobs.map((job) => job()));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
    const dataset = resolve(directory, 'training.jsonl');
    if (!state.stages.merge) {
      const provenance = await Promise.all(
        outputs.map(async (path) => ({ path, sha256: await fileDigest(path) })),
      );
      const merged = mergeCampaignLabels(
        await Promise.all(outputs.map(async (path) => jsonl(await readFile(path, 'utf8')))),
        provenance,
      );
      const bytes = merged.rows.map(JSON.stringify).join('\n') + '\n';
      if (!existsSync(dataset)) await writeFile(dataset, bytes, { flag: 'wx' });
      else if ((await readFile(dataset, 'utf8')) !== bytes)
        throw new Error('El dataset sin checkpoint no coincide con la mezcla reconstruida.');
      state.stages.merge = {
        status: 'complete',
        artifacts: { [dataset]: await fileDigest(dataset) },
        summary: merged.summary,
      };
      await save();
    }
    const sweep = resolve(state.runtime, '.ai-lab/campaign-sweep');
    const sweepReport = resolve(sweep, 'progress.json');
    await stage(
      'sweep',
      'sweep.mjs',
      [
        '--input',
        dataset,
        '--model',
        resolve(state.runtime, 'src/ai-models/hex-value.bin'),
        '--directory',
        sweep,
        '--learning-rates',
        options['learning-rates'],
        '--losses',
        options.losses,
        '--seeds',
        options.seeds,
        '--seed',
        options.seed,
        '--batch-size',
        options['batch-size'],
        '--epochs',
        options.epochs,
        '--split-group-field',
        'familyId',
        '--sample-weighting',
        options['sample-weighting'],
        '--max-runtime-minutes',
        Math.max(0.01, (deadline - Date.now() - 30000) / 60000),
        ...(existsSync(sweepReport) ? ['--resume'] : []),
      ],
      [sweepReport],
    );
    const trained = await json(sweepReport);
    for (const variant of Object.values(trained.completed)) {
      for (const [path, expected] of Object.entries(variant.artifacts)) {
        if ((await fileDigest(path)) !== expected)
          throw new Error(`Pesos o informe de entrenamiento modificados: ${path}`);
        state.stages.sweep.artifacts[path] = expected;
      }
    }
    await save();
    const candidates = Object.values(trained.completed)
      .filter(
        (variant) =>
          variant.bestEpoch > 0 &&
          variant.loss.validation < variant.loss.initialValidation * 0.99 &&
          variant.loss.validation < variant.loss.zeroBaselineValidation * 0.99,
      )
      .sort((left, right) => left.loss.validation - right.loss.validation)
      .slice(0, options.finalists);
    const finalists = [];
    for (const candidate of candidates) {
      const report = resolve(directory, `benchmark-${candidate.id}.json`);
      await stage(
        `benchmark-${candidate.id}`,
        'benchmark.mjs',
        [
          '--model',
          candidate.model,
          '--champion',
          resolve(sweep, 'champion.bin'),
          '--output',
          report,
          '--budget-ms',
          options['benchmark-ms'],
          '--depth',
          options['benchmark-depth'],
          '--seed',
          experimentSeed(options.seed, 0, 'campaign-benchmark'),
          '--partition',
          'development',
        ],
        [report],
      );
      const measured = await json(report);
      const candidateMetric = measured.summary.candidate?.verified;
      const championMetric = measured.summary.champion?.verified;
      finalists.push({
        ...candidate,
        benchmark: report,
        passesLocalTacticalGate: Boolean(
          candidateMetric &&
          championMetric &&
          candidateMetric.successes >= championMetric.successes &&
          candidateMetric.errors === 0,
        ),
      });
    }
    await verify();
    state.status = 'ready-for-independent-evaluation';
    state.finalists = finalists;
    state.finishedAt = new Date().toISOString();
    delete state.error;
    await save();
    console.log(
      `Campaña preparada: ${finalists.length} candidatos; ${checkpoint}. No se publican pesos.`,
    );
    return state;
  } catch (error) {
    stop();
    await Promise.allSettled([...completions]);
    if (state) {
      state.status = 'failed';
      state.error = error.message;
      await save();
    }
    throw error;
  } finally {
    await writes;
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = campaignOptions(process.argv.slice(2));
  if (options.help)
    console.log(
      'Campaña local congelada: --input trayectorias.jsonl --directory .ai-lab/campaña [--resume]. No publica pesos.',
    );
  else
    runCampaign(options).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
