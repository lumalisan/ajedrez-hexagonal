import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applySearchAction,
  createOpening,
  loadGameModules,
  parseArguments,
  seededRandom,
  writeJsonCheckpoint,
} from './shared.mjs';
import { canonicalJson, digest } from './research-data.mjs';
import { acquireResearchLock } from './research-state.mjs';
import { experimentSeed } from './selfplay-policy.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const personalities = ['balanced', 'aggressive', 'guardian', 'ambush'];
const toolFiles = [
  'scripts/ai/fresh-trajectories.mjs',
  'scripts/ai/shared.mjs',
  'scripts/ai/research-data.mjs',
  'scripts/ai/research-state.mjs',
  'scripts/ai/selfplay-policy.mjs',
];

export function freshTrajectoryOptions(argv) {
  const options = parseArguments(argv, {
    role: { type: 'string', required: true },
    games: { type: 'number', default: 100, integer: true, min: 1, max: 100000 },
    'max-plies': { type: 'number', default: 240, integer: true, min: 1, max: 2000 },
    'budget-ms': { type: 'number', default: 1500, integer: true, min: 20, max: 120000 },
    depth: { type: 'number', default: 5, integer: true, min: 1, max: 12 },
    seed: { type: 'number', required: true, integer: true, min: 0, max: 4294967295 },
    'opening-plies': { type: 'number', default: 4, integer: true, min: 4, max: 12 },
    directory: { type: 'string', required: true },
    'reference-root': { type: 'string', default: root },
    'exclude-manifest': { type: 'string' },
    resume: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (!options.help && !['development', 'confirmation'].includes(options.role)) {
    throw new Error('--role debe ser development o confirmation.');
  }
  return options;
}

export function openingFamilyId(initialState, actions, rules) {
  return `opening-${digest(
    canonicalJson({
      initialState: {
        ...initialState,
        pieces: [...initialState.pieces].sort((left, right) => left.id.localeCompare(right.id)),
        history: [],
      },
      opening: actions,
      rules,
    }),
  ).slice(0, 32)}`;
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function toolsFingerprint() {
  return Object.fromEntries(
    await Promise.all(
      toolFiles.map(async (path) => [path, digest(await readFile(resolve(root, path)))]),
    ),
  );
}

export async function createFreshSnapshot(directory, { referenceRoot = root, toolHashes } = {}) {
  const hashes = toolHashes ?? (await toolsFingerprint());
  const reference = resolve(referenceRoot);
  const runtime = resolve(directory, 'runtime');
  const files = [
    'package.json',
    ...toolFiles,
    ...(await readdir(resolve(reference, 'src'), { recursive: true }))
      .filter((path) => /\.(ts|tsx|js)$/.test(path))
      .map((path) => `src/${path}`),
  ];
  const snapshot = {};
  for (const path of files.sort()) {
    const target = resolve(runtime, path);
    await mkdir(dirname(target), { recursive: true });
    const sourceRoot = toolFiles.includes(path) ? root : reference;
    await copyFile(resolve(sourceRoot, path), target);
    snapshot[path] = digest(await readFile(target));
  }
  for (const path of toolFiles) {
    if (snapshot[path] !== hashes[path]) throw new Error('El código cambió mientras se congelaba.');
  }
  return { runtime, files: snapshot, referenceRoot: reference };
}

async function verifySnapshot(snapshot) {
  for (const [path, hash] of Object.entries(snapshot.files)) {
    if (digest(await readFile(resolve(snapshot.runtime, path))) !== hash) {
      throw new Error(`El profesor congelado fue modificado: ${path}.`);
    }
  }
}

async function excludedFamilies(path) {
  if (!path) return { ids: new Set(), sha256: null };
  const bytes = await readFile(resolve(path));
  const json = JSON.parse(bytes.toString('utf8'));
  const values = Array.isArray(json)
    ? json
    : (json.familyIds ?? json.games?.map((game) => game.familyId));
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value)) {
    throw new Error(
      'El manifiesto de exclusión necesita familyIds o un inventario con games[].familyId.',
    );
  }
  return { ids: new Set(values), sha256: digest(bytes) };
}

/** Confirmation draws layout and HP independently. No transformations augment the book. */
export function freshOpening(options, index, modules, excluded = new Set()) {
  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const choiceSeed = experimentSeed(
      options.seed,
      index,
      `fresh-${options.role}-choices`,
      attempt,
    );
    const random = seededRandom(choiceSeed);
    const confirmation = options.role === 'confirmation';
    const openingIndex = confirmation ? Math.floor(random() * 4294967296) : index;
    const fortressHp = confirmation
      ? 1 + Math.floor(random() * 3)
      : 1 + (Math.floor(index / 2) % 3);
    const prefixSeed = experimentSeed(options.seed, index, `fresh-${options.role}-prefix`, attempt);
    const opening = createOpening(modules, {
      seed: prefixSeed,
      index: openingIndex,
      openingPlies: options['opening-plies'],
      fortressHp,
    });
    if (opening.actions.length !== options['opening-plies'] || opening.state.outcome) continue;
    const rules = { ...modules.engine.DEFAULT_ACTION_RESOLUTION_RULES };
    const familyId = openingFamilyId(opening.initialState, opening.actions, rules);
    if (excluded.has(familyId)) continue;
    return {
      ...opening,
      rules,
      familyId,
      rejectedDraws: attempt,
      id: `fresh-${options.role}-${digest(`${options.seed}:${index}:${familyId}`).slice(0, 20)}`,
      choices: {
        choiceSeed,
        prefixSeed,
        openingIndex,
        layout: opening.initialLayout,
        fortressHp,
        openingPlies: options['opening-plies'],
        personalities: [
          personalities[Math.floor(random() * 4)],
          personalities[Math.floor(random() * 4)],
        ],
      },
    };
  }
  throw new Error('No se pudo generar una apertura nueva fuera de las familias excluidas.');
}

async function writeAtomic(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

function outputBytes(state) {
  if (state.settings.role === 'confirmation') {
    return `${JSON.stringify(
      {
        format: 'hex-arena-openings-v1',
        version: 1,
        role: 'confirmation',
        sourceRole: 'confirmation',
        confirmatory: true,
        provenance:
          'Fresh model-free random legal prefixes. No candidate or comparator is loaded. Must be generated and protocol-registered before confirmation outcomes are observed.',
        createdAt: state.createdAt,
        identity: state.identity,
        settings: state.settings,
        distribution: {
          layout: { 3: 0.5, 5: 0.5 },
          fortressHp: { 1: 1 / 3, 2: 1 / 3, 3: 1 / 3 },
          independentLayoutAndHpDraws: true,
          openingPlies: state.settings['opening-plies'],
          actions: 'Uniform among legal engine actions at each prefix state.',
          conditioning:
            'Reject terminal prefixes, excluded families and duplicate opening families. No rotations or player-swap augmentations.',
          statisticalScope:
            'Pseudorandom mixture with predeclared exclusions; distinct accepted families sampled without replacement, not a claim of exact IID.',
        },
        exclusions: { sha256: state.exclusionsHash, families: state.excludedFamilyCount },
        entries: state.games,
      },
      null,
      2,
    )}\n`;
  }
  const games = [...state.games, ...(state.inProgress ? [state.inProgress] : [])];
  return (
    [
      {
        kind: 'metadata',
        format: 'hexagonal-neural-dataset',
        version: 1,
        sourceRole: 'development',
        rules: 'Per game; current frozen engine configuration.',
        teacher: {
          evaluator: 'classic',
          neural: false,
          searchProfile: 'pvs-threats',
          rangedEvaluation: 'ranged-v1',
        },
        sourceHashes: state.snapshot.files,
        settings: state.settings,
        identity: state.identity,
        splitGrouping: 'familyId; opening variants remain in their original family.',
        createdAt: state.createdAt,
      },
      ...games.map((game) => ({ ...game, kind: 'game', sourceRole: 'development' })),
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n'
  );
}

async function save(directory, state) {
  const bytes = outputBytes(state);
  const hash = digest(bytes);
  if (hash !== state.outputHash) {
    state.previousOutputHash = state.outputHash ?? null;
    state.outputHash = hash;
  }
  state.updatedAt = new Date().toISOString();
  await writeJsonCheckpoint(resolve(directory, 'progress.json'), state);
  await writeAtomic(
    resolve(
      directory,
      state.settings.role === 'confirmation' ? 'openings.json' : 'trajectories.jsonl',
    ),
    bytes,
  );
}

/** All development searches use the private source snapshot; confirmation never searches. */
export async function runFreshTrajectories(options, dependencies = {}) {
  const directory = resolve(options.directory);
  await mkdir(directory, { recursive: true });
  const release = await acquireResearchLock(
    resolve(directory, 'run.lock'),
    Boolean(options.resume),
  );
  let modules;
  let state;
  try {
    const { resume: _resume, help: _help, ...settings } = options;
    void _resume;
    void _help;
    settings.directory = directory;
    settings['reference-root'] = resolve(options['reference-root'] ?? root);
    if (settings['exclude-manifest'])
      settings['exclude-manifest'] = resolve(settings['exclude-manifest']);
    const tools = dependencies.toolHashes ?? (await toolsFingerprint());
    const exclusions = await excludedFamilies(options['exclude-manifest']);
    const saved = await readOptional(resolve(directory, 'progress.json'));
    if (options.resume && !saved) throw new Error('No existe checkpoint para reanudar.');
    if (!options.resume && saved)
      throw new Error('El experimento existe; usa --resume u otra carpeta.');
    if (saved) {
      state = JSON.parse(saved);
      if (
        canonicalJson(state.settings) !== canonicalJson(settings) ||
        canonicalJson(state.toolHashes) !== canonicalJson(tools) ||
        state.exclusionsHash !== exclusions.sha256
      ) {
        throw new Error(
          'El rol, código, configuración o exclusiones no coinciden con el checkpoint.',
        );
      }
      if (!dependencies.modules) await verifySnapshot(state.snapshot);
    } else {
      const snapshot =
        dependencies.snapshot ??
        (await createFreshSnapshot(directory, {
          referenceRoot: settings['reference-root'],
          toolHashes: tools,
        }));
      state = {
        format: 'hex-fresh-trajectories-v1',
        version: 1,
        identity: digest(
          canonicalJson({
            settings,
            tools,
            snapshot: snapshot.files,
            exclusions: exclusions.sha256,
          }),
        ),
        settings,
        toolHashes: tools,
        snapshot,
        exclusionsHash: exclusions.sha256,
        excludedFamilyCount: exclusions.ids.size,
        createdAt: new Date().toISOString(),
        status: 'running',
        games: [],
        inProgress: null,
        searches: 0,
        nominalSearchMs: 0,
      };
    }
    const outputPath = resolve(
      directory,
      options.role === 'confirmation' ? 'openings.json' : 'trajectories.jsonl',
    );
    const existing = await readOptional(outputPath);
    if (
      existing !== null &&
      ![state.outputHash, state.previousOutputHash].includes(digest(existing))
    ) {
      throw new Error('La salida fue modificada fuera del experimento; no se sobrescribe.');
    }
    modules = dependencies.modules ?? (await loadGameModules({ root: state.snapshot.runtime }));
    const search = dependencies.search ?? modules.ai.searchMachineActionWithMetadata;
    const knownFamilies = new Set([
      ...exclusions.ids,
      ...state.games.map((game) => game.familyId),
      ...(state.inProgress ? [state.inProgress.familyId] : []),
    ]);
    state.status = 'running';
    delete state.error;
    await save(directory, state);
    while (state.games.length < options.games) {
      const index = state.games.length;
      if (!state.inProgress) {
        const opening = freshOpening(options, index, modules, knownFamilies);
        knownFamilies.add(opening.familyId);
        const base = {
          id: opening.id,
          gameId: opening.id,
          familyId: opening.familyId,
          seed: opening.seed,
          initialState: opening.initialState,
          actions: opening.actions,
          rules: opening.rules,
          choices: opening.choices,
          rejectedDraws: opening.rejectedDraws,
          initialLayout: opening.initialLayout,
          fortressHp: opening.fortressHp,
          openingPlies: opening.actions.length,
        };
        if (options.role === 'confirmation') {
          state.games.push(base);
          await save(directory, state);
          continue;
        }
        state.inProgress = {
          ...base,
          searches: [],
          outcome: null,
          termination: 'in-progress',
          finalPly: opening.state.ply,
          firstPlayedPly: opening.state.ply,
        };
        await save(directory, state);
      }
      const game = state.inProgress;
      let current = modules.engine.cloneState(game.initialState);
      for (const action of game.actions) {
        const result = modules.engine.applyAction(current, action, game.rules);
        if (!result.ok) throw new Error(`Checkpoint con acción ilegal: ${game.id}.`);
        current = result.state;
      }
      let lastSavedPly = current.ply;
      while (!current.outcome && current.ply - game.firstPlayedPly < options['max-plies']) {
        const result = await search(current, {
          difficulty: 'expert',
          personality: game.choices.personalities[current.activePlayer],
          budgetMs: options['budget-ms'],
          depth: options.depth,
          searchProfile: 'pvs-threats',
          rangedPlay: true,
          resolutionRules: game.rules,
          seed: experimentSeed(options.seed, index, 'fresh-development-search', current.ply),
        });
        state.searches += 1;
        state.nominalSearchMs += options['budget-ms'];
        game.searches.push({
          ply: current.ply,
          player: current.activePlayer,
          action: result.action,
          ...result.metadata,
        });
        current = applySearchAction(modules, current, result.action, game.rules);
        if (result.action) game.actions.push(result.action);
        game.finalPly = current.ply;
        if (current.ply - lastSavedPly >= 4) {
          await save(directory, state);
          lastSavedPly = current.ply;
        }
      }
      game.outcome = current.outcome;
      game.termination = current.outcome ? 'engine-outcome' : 'max-plies';
      game.finalState = current;
      state.games.push(game);
      state.inProgress = null;
      await save(directory, state);
    }
    state.status = 'complete';
    await save(directory, state);
    return state;
  } catch (error) {
    if (state && modules) {
      state.status = 'failed';
      state.error = error.message;
      await save(directory, state);
    }
    throw error;
  } finally {
    try {
      if (!dependencies.modules) await modules?.close();
    } finally {
      await release();
    }
  }
}

async function main() {
  const options = freshTrajectoryOptions(process.argv.slice(2));
  if (options.help) {
    console.log(
      'pnpm exec node scripts/ai/fresh-trajectories.mjs --role development|confirmation --games 100 --max-plies 240 --budget-ms 1500 --depth 5 --seed 123 --directory .ai-lab/fresh [--opening-plies 4] [--exclude-manifest familias.json] [--resume]\nConfirmation genera solo prefijos legales de 4–12 acciones, sin modelo ni búsqueda. Development juega con profesor clásico congelado y guarda cada cuatro plies; no genera etiquetas ni publica pesos.',
    );
    return;
  }
  const state = await runFreshTrajectories(options);
  console.log(
    `${state.status}: ${state.games.length} ${options.role}, ${new Set(state.games.map((game) => game.familyId)).size} familias; ${state.searches} búsquedas clásicas.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
