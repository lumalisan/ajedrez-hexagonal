import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameModules, parseArguments, writeJsonCheckpoint } from './shared.mjs';
import { canonicalJson, digest, normalizeRules, positionFingerprint } from './research-data.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ignoredDirectories = new Set(['runtime', 'node_modules', '.git', 'dist', 'coverage']);
const teacherFiles = ['src/ai.ts', 'src/ai-ranged.ts', 'src/engine.ts'];

export function inventoryOptions(argv) {
  const options = parseArguments(argv, {
    inputs: { type: 'string' },
    manifest: { type: 'string' },
    'reserved-manifest': { type: 'string' },
    output: { type: 'string', required: true },
    extract: { type: 'string' },
    'include-reserved': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (!options.help && Boolean(options.inputs) === Boolean(options.manifest)) {
    throw new Error('Indica exactamente --inputs o --manifest.');
  }
  return options;
}

/** No implicit search outside the supplied files/directories, and no symlink traversal. */
export async function inventoryInputs(options) {
  let entries;
  let base = root;
  if (options.manifest) {
    const path = resolve(options.manifest);
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    entries = Array.isArray(manifest) ? manifest : manifest.inputs;
    if (!Array.isArray(entries)) throw new Error('El manifiesto necesita una lista inputs.');
    base = dirname(path);
  } else {
    entries = options.inputs
      .split(',')
      .filter(Boolean)
      .map((path) => ({ path }));
  }
  const files = new Map();
  async function visit(path, configuration) {
    let children;
    try {
      children = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if (!['ENOTDIR', 'EINVAL'].includes(error.code)) throw error;
      if (['.json', '.jsonl'].includes(extname(path))) {
        const existing = files.get(path);
        if (existing && canonicalJson(existing) !== canonicalJson({ path, ...configuration })) {
          throw new Error(`La misma fuente tiene roles o familias incompatibles: ${path}.`, {
            cause: error,
          });
        }
        files.set(path, { path, ...configuration });
      }
      return;
    }
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      if (child.isSymbolicLink() || (child.isDirectory() && ignoredDirectories.has(child.name)))
        continue;
      if (child.isDirectory() || child.isFile())
        await visit(resolve(path, child.name), configuration);
    }
  }
  for (const entry of entries) {
    const item = typeof entry === 'string' ? { path: entry } : entry;
    if (!item?.path || (item.role && !['development', 'reserved'].includes(item.role))) {
      throw new Error('Entrada de manifiesto inválida; roles: development o reserved.');
    }
    if (item.familyId !== undefined && (typeof item.familyId !== 'string' || !item.familyId)) {
      throw new Error('familyId debe ser una cadena no vacía.');
    }
    await visit(resolve(base, item.path), { role: item.role, familyId: item.familyId });
  }
  if (options['reserved-manifest']) {
    const path = resolve(options['reserved-manifest']);
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    const reserved = Array.isArray(manifest) ? manifest : manifest.inputs;
    if (!Array.isArray(reserved))
      throw new Error('El manifiesto reservado necesita una lista inputs.');
    for (const item of reserved) {
      const entry = typeof item === 'string' ? { path: item } : item;
      if (!entry?.path) throw new Error('Fuente reservada sin ruta.');
      await visit(resolve(dirname(path), entry.path), {
        role: 'reserved',
        familyId: entry.familyId,
      });
    }
  }
  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function readDocument(bytes) {
  const text = bytes.toString('utf8').trim();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (json?.format === 'hexagonal-neural-arena' && json.version === 1) {
    return {
      header: json,
      format: 'arena',
      samples: [],
      games: [...json.games, ...(json.inProgress ? [json.inProgress] : [])],
    };
  }
  if (json?.version === 2 && json.config && json.initialState && Array.isArray(json.actions)) {
    return { header: json, format: 'record', samples: [], games: [json] };
  }
  if (!text.startsWith('{')) return null;
  const rows = text.split(/\r?\n/).map((line) => JSON.parse(line));
  const header = rows[0];
  if (header?.kind !== 'metadata' || header.format !== 'hexagonal-neural-dataset') return null;
  return {
    header,
    format: 'dataset',
    samples: rows.filter((row) => row.kind === 'sample'),
    games: rows.filter((row) => row.kind === 'game'),
  };
}

function labelStatus(document, currentHashes) {
  if (!document.samples.length) return 'not-labelled';
  if (
    document.header.evaluationVersion !== 'strategic-v2' ||
    document.header.labelVersion !== 'bounded-outcome-v2'
  ) {
    return 'obsolete-objective-or-evaluation';
  }
  const hashes = document.header.sourceHashes;
  if (!hashes || teacherFiles.some((path) => !hashes[path])) return 'unverified-teacher-hashes';
  return teacherFiles.every((path) => hashes[path] === currentHashes[path])
    ? 'current-verified'
    : 'obsolete-teacher-hashes';
}

function semanticState(state) {
  return {
    ...state,
    pieces: [...state.pieces].sort((left, right) => left.id.localeCompare(right.id)),
    history: [],
  };
}

function phase(state) {
  const units = state.pieces.filter((piece) => piece.type !== 'fortress').length;
  return units <= 6 ? 'endgame' : state.ply <= 20 ? 'opening' : 'middlegame';
}

function increment(counts, name, amount = 1) {
  counts[name] = (counts[name] ?? 0) + amount;
}

function replay(game, rules, modules) {
  const errors = modules.engine.validateState(game.initialState);
  if (errors.length) throw new Error(errors.join('; '));
  if (!Array.isArray(game.actions)) throw new Error('Sin diario de acciones.');
  let state = modules.engine.cloneState(game.initialState);
  const phases = {};
  const positions = new Set();
  const phasePositions = { opening: new Set(), middlegame: new Set(), endgame: new Set() };
  const hp = {};
  for (const [index, action] of game.actions.entries()) {
    if (state.outcome) throw new Error(`Orden ${index + 1} después del final.`);
    const features = [0, 1].map((player) =>
      modules.neural.encodeNeuralFeatures(state, player, rules),
    );
    const fingerprint = positionFingerprint(features, rules);
    const stage = phase(state);
    positions.add(fingerprint);
    phasePositions[stage].add(fingerprint);
    increment(phases, stage);
    const health = [0, 1]
      .map(
        (player) =>
          state.pieces.find((piece) => piece.type === 'fortress' && piece.owner === player)?.hp ??
          0,
      )
      .join(':');
    increment(hp, health);
    const next = modules.engine.applyAction(state, action, rules);
    if (!next.ok)
      throw new Error(`Orden ${index + 1} ilegal: ${next.error ?? 'rechazada por el motor'}.`);
    state = next.state;
  }
  const outcome =
    state.outcome && !['resignation', 'timeout'].includes(state.outcome.reason)
      ? state.outcome
      : null;
  return { positions, phasePositions, phases, hp, finalState: state, outcome };
}

/** Inventory is read-only with respect to sources; extraction contains no reused teacher labels. */
export async function buildDatasetInventory(options, dependencies = {}) {
  const files = dependencies.files ?? (await inventoryInputs(options));
  const modules = dependencies.modules ?? (await loadGameModules());
  const currentHashes =
    dependencies.sourceHashes ??
    Object.fromEntries(
      await Promise.all(
        teacherFiles.map(async (path) => [path, digest(await readFile(resolve(root, path)))]),
      ),
    );
  const report = {
    format: 'hexagonal-dataset-inventory',
    version: 1,
    createdAt: new Date().toISOString(),
    settings: options,
    currentHashes,
    files: [],
    games: [],
    summary: {},
    definitions: {
      position: 'One board state before a legal action; two perspectives do not double this count.',
      phase:
        'endgame: at most 6 non-Fortress pieces; otherwise opening: ply <=20; otherwise middlegame.',
      family:
        'Explicit source lineage, otherwise identical initial board/history counters/rules and complete recorded opening. Unknown opening lineage is reported and grouped only by exact trajectory.',
      suitability:
        'Trajectories replayed legally under the current engine can be relabelled. Old/unverified labels are never extracted.',
      reserved:
        'Arenas, their derived datasets, and explicit reserved sources are excluded from development extraction; overlapping families are reserved too.',
    },
  };
  const games = new Map();
  try {
    for (const file of files) {
      const bytes = await readFile(file.path);
      const entry = { path: file.path, sha256: digest(bytes), bytes: bytes.length };
      report.files.push(entry);
      let document;
      try {
        document = readDocument(bytes);
      } catch (error) {
        entry.status = 'invalid-or-unrelated-json';
        entry.error = error.message;
        continue;
      }
      if (!document) {
        entry.status = 'not-a-trajectory-source';
        continue;
      }
      const { header } = document;
      const derivedFromReserved =
        /(?:arena|evaluation|reserved|screening|champion|expert)[^/\\]*\.json$/i.test(
          header.input?.path ?? header.settings?.input ?? '',
        ) || /(?:^|[/\\])evaluation[^/\\]*[/\\]/i.test(header.input?.path ?? '');
      entry.role =
        document.format === 'arena' || file.role === 'reserved' || derivedFromReserved
          ? 'reserved'
          : 'development';
      entry.format = document.format;
      entry.status = document.games.length ? 'inspected' : 'labels-only-no-trajectory';
      entry.labels = labelStatus(document, currentHashes);
      entry.evaluationVersion = header.evaluationVersion ?? null;
      entry.labelVersion = header.labelVersion ?? null;
      entry.engineHash = header.sourceHashes?.['src/engine.ts'] ?? null;
      entry.engineProvenance =
        entry.engineHash === currentHashes['src/engine.ts']
          ? 'current-verified'
          : entry.engineHash
            ? 'different-engine-hash'
            : 'not-recorded';
      entry.sampleRows = document.samples.length;
      entry.gameRows = document.games.length;
      entry.legalGames = 0;
      entry.invalidGames = [];
      for (const source of document.games) {
        try {
          let game = source;
          let sourceRules;
          if (document.format === 'record') {
            const record = modules.records.parseRecord(bytes.toString('utf8'));
            sourceRules = modules.records.resolutionRulesForConfig(record.config);
            game = { ...record, actions: record.actions };
          } else {
            sourceRules = source.rules ?? header.rules;
          }
          const rules = normalizeRules(sourceRules);
          const normalized = {
            initialState: semanticState(game.initialState),
            actions: game.actions,
            rules,
          };
          const identity = digest(canonicalJson(normalized));
          const explicitFamily = file.familyId ?? source.familyId ?? source.sourceFamilyId;
          // A concatenated dataset's header describes its first source, not every replay.
          const recordedOpening = source.openingPlies;
          const openingPlies =
            Number.isSafeInteger(recordedOpening) &&
            recordedOpening > 0 &&
            recordedOpening <= game.actions.length
              ? recordedOpening
              : null;
          const familyMethod = explicitFamily
            ? 'explicit-lineage'
            : openingPlies
              ? 'recorded-opening'
              : 'unknown-lineage';
          const familyId =
            explicitFamily ??
            (openingPlies
              ? `opening-${digest(canonicalJson({ initialState: normalized.initialState, opening: game.actions.slice(0, openingPlies), rules })).slice(0, 32)}`
              : `trajectory-${identity.slice(0, 32)}`);
          let known = games.get(identity);
          if (!known) {
            const result = replay(game, rules, modules);
            known = {
              identity,
              familyId,
              familyMethod,
              openingPlies,
              gameId: `inventory-${identity.slice(0, 32)}`,
              initialState: game.initialState,
              actions: game.actions,
              rules,
              ...result,
              sources: [],
              roles: new Set(),
            };
            games.set(identity, known);
          } else if (known.familyId !== familyId) {
            if (known.familyMethod === 'explicit-lineage' && explicitFamily)
              throw new Error('La trayectoria tiene linajes explícitos contradictorios.');
            if (explicitFamily || (known.familyMethod === 'unknown-lineage' && openingPlies)) {
              known.familyId = familyId;
              known.familyMethod = familyMethod;
              known.openingPlies = openingPlies;
            }
          }
          known.sources.push(file.path);
          known.roles.add(entry.role);
          entry.legalGames += 1;
        } catch (error) {
          entry.invalidGames.push({ sourceGameId: source.gameId ?? null, error: error.message });
        }
      }
      entry.suitability = entry.legalGames
        ? 'legal-trajectories-for-reanalysis'
        : 'unusable-without-original-trajectories';
    }
    const reservedFamilies = new Set(
      [...games.values()].filter((game) => game.roles.has('reserved')).map((game) => game.familyId),
    );
    const extraction = [];
    for (const role of ['development', 'reserved']) {
      const positionIds = new Set();
      const families = new Set();
      const phasePositions = { opening: new Set(), middlegame: new Set(), endgame: new Set() };
      const counts = {
        games: 0,
        families: 0,
        positions: 0,
        outcomes: {},
        hp: {},
        phasePositions: {},
        trajectoriesWithBoardOutcome: 0,
      };
      for (const game of games.values()) {
        const finalRole = reservedFamilies.has(game.familyId) ? 'reserved' : 'development';
        if (finalRole !== role) continue;
        counts.games += 1;
        families.add(game.familyId);
        for (const fingerprint of game.positions) positionIds.add(fingerprint);
        for (const stage of Object.keys(phasePositions))
          for (const fingerprint of game.phasePositions[stage])
            phasePositions[stage].add(fingerprint);
        for (const [hp, amount] of Object.entries(game.hp)) increment(counts.hp, hp, amount);
        increment(
          counts.outcomes,
          game.outcome ? `${game.outcome.type}:${game.outcome.reason}` : 'unfinished',
        );
        counts.trajectoriesWithBoardOutcome += Number(Boolean(game.outcome));
        report.games.push({
          gameId: game.gameId,
          identity: game.identity,
          familyId: game.familyId,
          familyMethod: game.familyMethod,
          openingPlies: game.openingPlies,
          role,
          sources: [...new Set(game.sources)].sort(),
          actions: game.actions.length,
          positions: game.positions.size,
          phases: game.phases,
          hp: game.hp,
          outcome: game.outcome,
          sharedWithReserved: game.roles.has('development') && role === 'reserved',
        });
        if (role === 'development' || options['include-reserved'])
          extraction.push({
            kind: 'game',
            gameId: game.gameId,
            identity: game.identity,
            familyId: game.familyId,
            familyMethod: game.familyMethod,
            openingPlies: game.openingPlies,
            sourceRole: role,
            sources: [...new Set(game.sources)].sort(),
            initialState: game.initialState,
            actions: game.actions,
            rules: game.rules,
            outcome: game.outcome,
            finalPly: game.finalState.ply,
            termination: game.outcome ? 'engine-outcome' : 'unfinished-board',
          });
      }
      counts.families = families.size;
      counts.positions = positionIds.size;
      counts.phasePositions = Object.fromEntries(
        Object.entries(phasePositions).map(([stage, positions]) => [stage, positions.size]),
      );
      report.summary[role] = counts;
    }
    report.summary.files = files.length;
    report.summary.sourcesWithTrajectories = report.files.filter((file) => file.legalGames).length;
    report.summary.labelsOnlySources = report.files.filter(
      (file) => file.status === 'labels-only-no-trajectory',
    ).length;
    report.summary.extractedGames = extraction.length;
    if (options.extract) {
      const output = resolve(options.extract);
      if (files.some((file) => file.path === output))
        throw new Error('La extracción no puede sobrescribir una fuente.');
      await mkdir(dirname(output), { recursive: true });
      await writeFile(
        output,
        [
          {
            kind: 'metadata',
            format: 'hexagonal-neural-dataset',
            version: 1,
            schema: modules.neural.NEURAL_FEATURE_SCHEMA,
            inputSize: modules.neural.NEURAL_INPUT_SIZE,
            rules: 'Per game; explicit original configurations.',
            sourceHashes: currentHashes,
            sourceRole: options['include-reserved'] ? 'mixed-explicitly-authorized' : 'development',
            splitGrouping: 'familyId; consumers must preserve this grouping before splitting.',
            sources: report.files
              .filter((file) => extraction.some((game) => game.sources.includes(file.path)))
              .map((file) => ({ path: file.path, sha256: file.sha256, role: file.role })),
          },
          ...extraction,
        ]
          .map((row) => JSON.stringify(row))
          .join('\n') + '\n',
        { flag: 'wx' },
      );
    }
    if (options.output) {
      const output = resolve(options.output);
      if (files.some((file) => file.path === output))
        throw new Error('El informe no puede sobrescribir una fuente.');
      await writeJsonCheckpoint(output, report);
    }
    return report;
  } finally {
    if (!dependencies.modules) await modules.close();
  }
}

async function main() {
  const options = inventoryOptions(process.argv.slice(2));
  if (options.help) {
    console.log(`Inventaría y valida trayectorias de fuentes indicadas explícitamente, sin búsquedas.
pnpm exec node scripts/ai/dataset-inventory.mjs --inputs .ai-lab --output .ai-lab/inventory.json
  [--extract .ai-lab/development-trajectories.jsonl]
También --manifest fuentes.json, con {inputs:[{path,role?,familyId?}]}; rutas relativas al manifiesto.
Las arenas y sus familias quedan reservadas. --include-reserved autoriza su extracción explícita.
La extracción no reutiliza etiquetas y exige conservar familyId antes del split.`);
    return;
  }
  const report = await buildDatasetInventory(options);
  for (const role of ['development', 'reserved']) {
    const summary = report.summary[role];
    console.log(
      `${role}: ${summary.games} trayectorias, ${summary.families} familias, ${summary.positions} posiciones únicas, ${summary.phasePositions.endgame} finales.`,
    );
  }
  console.log(`Informe: ${relative(root, resolve(options.output))}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
