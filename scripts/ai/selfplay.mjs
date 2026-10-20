import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { commonArguments, parseArguments, writeJsonCheckpoint } from './shared.mjs';
import { experimentSeed, promotionDecision, trainingDecision } from './selfplay-policy.mjs';

const options = parseArguments(process.argv.slice(2), {
  ...commonArguments,
  directory: { type: 'string', default: '.ai-lab/selfplay' },
  model: { type: 'string', default: 'src/ai-models/hex-value.bin' },
  replays: { type: 'string' },
  rounds: { type: 'number', default: 3, integer: true, min: 1, max: 10000 },
  games: { type: 'number', default: 24, integer: true, min: 4, max: 100000 },
  pairs: { type: 'number', default: 8, integer: true, min: 1, max: 10000 },
  'play-budget-ms': { type: 'number', default: 1500, integer: true, min: 20, max: 120000 },
  'play-depth': { type: 'number', default: 5, integer: true, min: 1, max: 12 },
  epochs: { type: 'number', default: 80, integer: true, min: 1, max: 10000 },
  resume: { type: 'boolean', default: false },
  publish: { type: 'boolean', default: false },
  'learning-rate': { type: 'number', default: 0.0002, min: 0.000001, max: 1 },
  'weight-decay': { type: 'number', default: 0.001, min: 0, max: 1 },
});

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = resolve(root, options.directory);
const checkpoint = resolve(directory, 'progress.json');
const hash = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
async function sourceFingerprint() {
  const paths = ['package.json', 'pnpm-lock.yaml'];
  for (const folder of ['src', 'scripts/ai']) {
    for (const path of await readdir(resolve(root, folder), { recursive: true })) {
      if (/\.(ts|tsx|mjs|py|js)$/.test(path)) paths.push(`${folder}/${path}`);
    }
  }
  const digest = createHash('sha256');
  for (const path of paths.sort()) digest.update(path).update(await hash(resolve(root, path)));
  return digest.digest('hex');
}

function run(script, args) {
  return new Promise((accept, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(root, 'scripts/ai', script), ...args.map(String)],
      {
        cwd: root,
        stdio: 'inherit',
      },
    );
    const stop = () => child.kill();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const cleanup = () => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    };
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('exit', (code) => {
      cleanup();
      if (code === 0) accept();
      else reject(new Error(`${script} terminó con código ${code}. Reanuda con --resume.`));
    });
  });
}

async function combine(inputs, destination) {
  const output = await open(destination, 'w');
  let headerWritten = false;
  try {
    for (const input of inputs) {
      const stream = createReadStream(input, { encoding: 'utf8' });
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (!line.trim()) continue;
          const row = JSON.parse(line);
          if (row.kind === 'metadata') {
            if (row.labelVersion !== 'bounded-outcome-v2')
              throw new Error('Dataset con etiquetas incompatibles.');
            if (row.evaluationVersion !== 'strategic-v2')
              throw new Error(
                'Dataset con evaluación anterior; recalcula las búsquedas con ai:prepare-replays.',
              );
            if (headerWritten) continue;
            row.sources = inputs;
            headerWritten = true;
            await output.write(`${JSON.stringify(row)}\n`);
          } else await output.write(`${line}\n`);
        }
      } finally {
        lines.close();
        stream.destroy();
      }
    }
    await output.sync();
  } finally {
    await output.close();
  }
}

async function main() {
  if (options.help) {
    console.log(`Autojuego → entrenamiento → torneos contra campeón y Experto → promoción local.
pnpm ai:selfplay [--rounds 3 --games 24 --pairs 8 --seed 1] [--resume]
--directory .ai-lab/selfplay guarda modelos, datos e informes. Ctrl+C para detener.
--play-budget-ms 1500 --play-depth 5 para generar; --budget-ms 15000 --depth 9 para evaluar.
--max-plies 240 --epochs 80. Reanudar exige los mismos parámetros; puedes aumentar --rounds.
Se retienen datos de las últimas 3 rondas y rivales históricos. No se entrena con los torneos.
Continúa los pesos del campeón con AdamW nuevo (--learning-rate 0.0002 --weight-decay 0.001).
--replays dataset.jsonl añade partidas preparadas con ai:prepare-replays, con búsquedas actuales.
Primero exige mejorar la validación y un cribado de 4 partidas a 250 ms antes del torneo largo.
Promoción: >=8 pares, >=80% terminadas y >=60% de puntos sobre TODAS las partidas
contra el campeón; >=50% contra Experto, con los mismos mínimos. Es un filtro práctico,
no una prueba estadística. Menos de 8 pares solo verifica el circuito, sin promociones.
El campeón queda en progress.json. --publish lo instala en el juego si supera los filtros
con 15000 ms/profundidad 9 y pasa la comprobación del navegador; conserva copias anteriores.
Requiere Python con NumPy (AI_PYTHON permite indicar el ejecutable).`);
    return;
  }
  // Fail before spending time on games if the training runtime is unavailable.
  await run('train.mjs', ['--help']);
  await mkdir(directory, { recursive: true });
  const lockPath = resolve(directory, 'run.lock');
  const lock = await open(lockPath, 'wx');
  await lock.write(`${process.pid}\n`);
  try {
    const { resume: _resume, rounds: _rounds, help: _help, ...settings } = options;
    void _resume;
    void _rounds;
    void _help;
    let state;
    const sources = await sourceFingerprint();
    if (options.resume) {
      state = await json(checkpoint);
      if (JSON.stringify(state.settings) !== JSON.stringify(settings)) {
        throw new Error(
          'Los parámetros no coinciden con el proceso guardado. Usa otro --directory.',
        );
      }
      if (state.sources !== sources)
        throw new Error(
          'El código ha cambiado. Inicia otro --directory para comparar versiones coherentes.',
        );
    } else {
      // Never silently replace an existing run.
      const fresh = await open(checkpoint, 'wx');
      await fresh.close();
      const initial = resolve(directory, 'initial.bin');
      await copyFile(resolve(root, options.model), initial);
      state = {
        version: 1,
        sources,
        settings,
        champion: initial,
        champions: [initial],
        rounds: [],
        artifacts: {},
        published: {},
      };
      if (options.publish) {
        for (const suffix of ['', '.training.json', '.parity.json']) {
          const shipped = resolve(root, `src/ai-models/hex-value.bin${suffix}`);
          state.published[shipped] = await hash(shipped);
          const backup = resolve(directory, `original.bin${suffix}`);
          await copyFile(shipped, backup);
          state.artifacts[backup] = await hash(backup);
        }
      }
      state.artifacts[initial] = await hash(initial);
      if (options.replays) {
        const input = resolve(root, options.replays);
        const header = JSON.parse((await readFile(input, 'utf8')).split(/\r?\n/)[0]);
        if (
          header.labelVersion !== 'bounded-outcome-v2' ||
          header.evaluationVersion !== 'strategic-v2' ||
          !header.sourceHashes
        ) {
          throw new Error(
            'Prepara las partidas con ai:prepare-replays antes de incorporarlas al ciclo.',
          );
        }
        for (const [path, expected] of Object.entries(header.sourceHashes)) {
          if ((await hash(resolve(root, path))) !== expected)
            throw new Error(`Las búsquedas de replays no corresponden al código actual: ${path}`);
        }
        state.replays = resolve(directory, 'replays.jsonl');
        await copyFile(input, state.replays);
        state.artifacts[state.replays] = await hash(state.replays);
      }
      await writeJsonCheckpoint(checkpoint, state);
    }
    for (const [path, expected] of Object.entries(state.artifacts)) {
      if ((await hash(path)) !== expected) throw new Error(`Artefacto modificado: ${path}`);
    }
    const stage = async (round, name, outputs, action) => {
      if (round.stages.includes(name)) return;
      if ((await sourceFingerprint()) !== state.sources) {
        throw new Error('El código cambió durante el ciclo. Se detiene para no mezclar versiones.');
      }
      console.log(`Ronda ${round.index + 1}: ${name}`);
      await action();
      for (const path of outputs) state.artifacts[path] = await hash(path);
      round.stages.push(name);
      await writeJsonCheckpoint(checkpoint, state);
    };
    for (let index = 0; index < options.rounds; index += 1) {
      let round = state.rounds[index];
      if (round?.complete) continue;
      const folder = resolve(directory, `round-${String(index + 1).padStart(4, '0')}`);
      await mkdir(folder, { recursive: true });
      if (!round) {
        round = { index, champion: state.champion, stages: [], datasets: [] };
        state.rounds.push(round);
        await writeJsonCheckpoint(checkpoint, state);
      }
      // Two games per checkpoint bounds regeneration after an interruption.
      for (let game = 0; game < options.games; game += 2) {
        const path = resolve(folder, `games-${game}.jsonl`);
        const historical =
          state.rounds[index - 1]?.candidate ??
          state.champions[Math.max(0, state.champions.length - 2)];
        await stage(round, `autojuego-${game}`, [path], () =>
          run('generate.mjs', [
            '--model',
            round.champion,
            '--opponent-model',
            historical,
            '--games',
            Math.min(2, options.games - game),
            '--game-offset',
            game,
            '--outcome-weight',
            0.25,
            '--output',
            path,
            '--overwrite',
            '--residual',
            '--seed',
            experimentSeed(options.seed, index, 'play', game),
            '--budget-ms',
            options['play-budget-ms'],
            '--depth',
            options['play-depth'],
            '--max-plies',
            options['max-plies'],
            '--opening-plies',
            options['opening-plies'],
            ...(options['fortress-hp'] ? ['--fortress-hp', options['fortress-hp']] : []),
          ]),
        );
        if (!round.datasets.includes(path)) round.datasets.push(path);
      }
      const dataset = resolve(folder, 'training.jsonl');
      await stage(round, 'dataset', [dataset], () =>
        combine(
          [
            ...state.rounds
              .slice(Math.max(0, index - 2), index + 1)
              .flatMap((entry) => entry.datasets),
            ...(state.replays ? [state.replays] : []),
          ],
          dataset,
        ),
      );
      const candidate = resolve(folder, 'candidate.bin');
      await stage(
        round,
        'entrenamiento',
        [candidate, `${candidate}.training.json`, `${candidate}.parity.json`],
        () =>
          run('train.mjs', [
            '--input',
            dataset,
            '--output',
            candidate,
            '--epochs',
            options.epochs,
            '--seed',
            experimentSeed(options.seed, index, 'train'),
            '--teacher-weight',
            1,
            '--antisymmetric',
            '--initialize-model',
            round.champion,
            '--split-policy',
            'hash-threshold',
            '--split-seed',
            experimentSeed(options.seed, 0, 'validation'),
            '--learning-rate',
            options['learning-rate'],
            '--weight-decay',
            options['weight-decay'],
          ]),
      );
      round.candidate = candidate;
      if (!trainingDecision(await json(`${candidate}.training.json`))) {
        round.rejection =
          'El entrenamiento no mejora un 1% la validación inicial y el baseline sin corrección.';
        round.promoted = false;
        round.complete = true;
        await writeJsonCheckpoint(checkpoint, state);
        console.log(round.rejection);
        continue;
      }
      const screening = resolve(folder, 'screening.json');
      await stage(round, 'cribado', [screening], () =>
        run('arena.mjs', [
          '--model',
          candidate,
          '--reference-model',
          round.champion,
          '--output',
          screening,
          '--pairs',
          2,
          '--budget-ms',
          250,
          '--depth',
          5,
          '--max-plies',
          120,
          '--fortress-hp',
          1,
          '--seed',
          experimentSeed(options.seed, index, 'screening'),
          ...(existsSync(screening) ? ['--resume'] : []),
        ]),
      );
      const screen = (await json(screening)).summary;
      if (screen.wins <= screen.losses) {
        round.rejection =
          'El cribado corto no aporta más victorias que derrotas; no se inicia el torneo largo.';
        round.promoted = false;
        round.complete = true;
        await writeJsonCheckpoint(checkpoint, state);
        console.log(round.rejection);
        continue;
      }
      for (const reference of ['champion', 'expert']) {
        const report = resolve(folder, `${reference}.json`);
        await stage(round, `torneo-${reference}`, [report], () =>
          run('arena.mjs', [
            '--model',
            candidate,
            '--output',
            report,
            '--pairs',
            options.pairs,
            '--seed',
            experimentSeed(options.seed, index, 'evaluation'),
            '--budget-ms',
            options['budget-ms'],
            '--depth',
            options.depth,
            '--max-plies',
            options['max-plies'],
            '--opening-plies',
            options['opening-plies'],
            ...(existsSync(report) ? ['--resume'] : []),
            '--stop-on-rejection',
            '--minimum-score',
            reference === 'champion' ? 0.6 : 0.5,
            ...(reference === 'champion' ? ['--reference-model', round.champion] : []),
            ...(options['fortress-hp'] ? ['--fortress-hp', options['fortress-hp']] : []),
          ]),
        );
        if (
          !promotionDecision(await json(report), {
            pairs: options.pairs,
            minimumScore: reference === 'champion' ? 0.6 : 0.5,
          })
        )
          break;
      }
      const gate = { pairs: options.pairs };
      round.promoted =
        promotionDecision(await json(resolve(folder, 'champion.json')), gate) &&
        existsSync(resolve(folder, 'expert.json')) &&
        promotionDecision(await json(resolve(folder, 'expert.json')), {
          ...gate,
          minimumScore: 0.5,
        });
      if (round.promoted) {
        if (options.publish && options['budget-ms'] === 15000 && options.depth === 9) {
          const browserReport = resolve(folder, 'browser.json');
          await stage(round, 'navegador', [browserReport], () =>
            run('browser-smoke.mjs', ['--model', candidate, '--output', browserReport]),
          );
          for (const [path, expected] of Object.entries(state.published)) {
            const actual = await hash(path);
            if (actual !== expected && actual !== round.publication?.[path]) {
              throw new Error(`El modelo del juego ha cambiado: ${path}`);
            }
          }
          // Save intended hashes first so an interrupted publication can be retried safely.
          round.publication = {};
          for (const suffix of ['.training.json', '.parity.json', '']) {
            round.publication[resolve(root, `src/ai-models/hex-value.bin${suffix}`)] = await hash(
              `${candidate}${suffix}`,
            );
          }
          await writeJsonCheckpoint(checkpoint, state);
          for (const suffix of ['.training.json', '.parity.json', '']) {
            const path = resolve(root, `src/ai-models/hex-value.bin${suffix}`);
            await copyFile(`${candidate}${suffix}`, path);
            state.published[path] = round.publication[path];
          }
          round.published = true;
        }
        state.champion = candidate;
        state.champions.push(candidate);
      }
      round.candidate = candidate;
      round.complete = true;
      await writeJsonCheckpoint(checkpoint, state);
      console.log(
        `Ronda ${index + 1}: ${round.promoted ? 'campeón actualizado' : 'campeón conservado'}.`,
      );
    }
    console.log(`Ciclo terminado. Campeón: ${state.champion}. Estado: ${checkpoint}`);
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
