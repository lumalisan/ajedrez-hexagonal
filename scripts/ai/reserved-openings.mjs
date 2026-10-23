import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameModules, parseArguments } from './shared.mjs';
import { canonicalJson, digest, normalizeRules, positionFingerprint } from './research-data.mjs';
import { experimentSeed } from './selfplay-policy.mjs';
import { createEndgameCases } from './endgame-cases.mjs';

function trajectoryIdentity(game, rules) {
  return digest(
    canonicalJson({
      initialState: {
        ...game.initialState,
        pieces: [...game.initialState.pieces].sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
        history: [],
      },
      actions: game.actions,
      rules,
    }),
  );
}

function sourceGames(text) {
  try {
    const json = JSON.parse(text);
    if (json.format === 'hexagonal-neural-arena') {
      return [...json.games, ...(json.inProgress ? [json.inProgress] : [])].map((game) => ({
        game,
        rules: normalizeRules(game.rules ?? json.rules),
      }));
    }
  } catch {
    // A dataset with game rows is JSONL rather than a single JSON document.
  }
  const rows = text.trim().split(/\r?\n/).map(JSON.parse);
  if (rows[0]?.format !== 'hexagonal-neural-dataset') return [];
  return rows
    .filter((row) => row.kind === 'game')
    .map((game) => ({
      game,
      rules: normalizeRules(game.rules ?? rows[0].rules),
    }));
}

const unitCount = (state) => state.pieces.filter((piece) => piece.type !== 'fortress').length;
const health = (state) =>
  [0, 1].map(
    (player) =>
      state.pieces.find((piece) => piece.type === 'fortress' && piece.owner === player)?.hp ?? 0,
  );

function compareCandidates(left, right, preferredUnits) {
  const rank = (candidate) => [
    Number(candidate.nonFortressUnits <= preferredUnits),
    Number(candidate.boardProgress > 0),
    -candidate.nonFortressUnits,
    candidate.boardProgress,
    candidate.prefixPlies,
  ];
  const leftRank = rank(left);
  const rightRank = rank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) return rightRank[index] - leftRank[index];
  }
  return left.sourceIdentity.localeCompare(right.sourceIdentity);
}

/** A known development book, selected only by material/progress; never a fresh holdout. */
export async function buildReservedOpenings(options, dependencies = {}) {
  const inventoryPath = resolve(options.inventory);
  const inventoryBytes = await readFile(inventoryPath);
  const inventory = JSON.parse(inventoryBytes.toString('utf8'));
  if (inventory.format !== 'hexagonal-dataset-inventory' || inventory.version !== 1) {
    throw new Error('Se requiere un inventario de trayectorias validado v1.');
  }
  const selected = new Map(
    inventory.games.filter((game) => game.role === 'reserved').map((game) => [game.identity, game]),
  );
  const sources = new Map(inventory.files.map((file) => [file.path, file]));
  const filePaths = [...new Set([...selected.values()].flatMap((game) => game.sources))].sort();
  const modules = dependencies.modules ?? (await loadGameModules());
  const families = new Map();
  const seen = new Set();
  const originalStateCoverage = {
    trajectories: 0,
    statesWithinPrefix: 0,
    preferredStatesWithinPrefix: 0,
    preferredStatesAnywhere: 0,
    familiesWithPreferredAnywhere: new Set(),
  };
  try {
    for (const path of filePaths) {
      const bytes = await readFile(path);
      const sourceHash = digest(bytes);
      if (sourceHash !== sources.get(path)?.sha256)
        throw new Error(`La fuente cambió después del inventario: ${path}`);
      for (const { game, rules } of sourceGames(bytes.toString('utf8'))) {
        const identity = trajectoryIdentity(game, rules);
        const recorded = selected.get(identity);
        if (!recorded || seen.has(identity)) continue;
        seen.add(identity);
        originalStateCoverage.trajectories += 1;
        const initialUnits = unitCount(game.initialState);
        const initialHp = health(game.initialState).reduce((sum, hp) => sum + hp, 0);
        let state = modules.engine.cloneState(game.initialState);
        for (let index = 0; index < game.actions.length; index += 1) {
          if (state.outcome)
            throw new Error(`La trayectoria terminó antes de la orden ${index}: ${identity}`);
          const units = unitCount(state);
          if (units <= options['preferred-units']) {
            originalStateCoverage.preferredStatesAnywhere += 1;
            originalStateCoverage.familiesWithPreferredAnywhere.add(recorded.familyId);
          }
          if (index <= options['maximum-prefix-plies']) {
            originalStateCoverage.statesWithinPrefix += 1;
            if (units <= options['preferred-units'])
              originalStateCoverage.preferredStatesWithinPrefix += 1;
            const hp = health(state);
            const candidate = {
              id: `reserved-dev-${digest(recorded.familyId).slice(0, 16)}`,
              familyId: recorded.familyId,
              seed: experimentSeed(options.seed, 0, `reserved-development:${recorded.familyId}`),
              initialState: game.initialState,
              actions: game.actions.slice(0, index),
              rules,
              sourceIdentity: identity,
              sourcePath: path,
              sourceHash,
              prefixPlies: index,
              statePly: state.ply,
              nonFortressUnits: units,
              fortressHp: hp,
              boardProgress:
                Math.max(0, initialUnits - units) +
                Math.max(0, initialHp - hp.reduce((sum, value) => sum + value, 0)),
              phase:
                units <= 6
                  ? 'endgame'
                  : units <= options['preferred-units']
                    ? 'reduced-material'
                    : state.ply <= 20
                      ? 'opening'
                      : 'middlegame',
              stateFingerprint: positionFingerprint(
                [0, 1].map((player) => modules.neural.encodeNeuralFeatures(state, player, rules)),
                rules,
              ),
            };
            if (
              options['first-reduced-after-minimum'] &&
              (units > options['preferred-units'] || state.ply < options['minimum-state-ply'])
            ) {
              const result = modules.engine.applyAction(state, game.actions[index], rules);
              if (!result.ok) throw new Error(`Replay ilegal (${identity}, orden ${index + 1}).`);
              state = result.state;
              continue;
            }
            const previous = families.get(recorded.familyId);
            const better = options['first-reduced-after-minimum']
              ? !previous ||
                candidate.statePly < previous.statePly ||
                (candidate.statePly === previous.statePly &&
                  candidate.sourceIdentity.localeCompare(previous.sourceIdentity) < 0)
              : !previous || compareCandidates(candidate, previous, options['preferred-units']) < 0;
            if (better) {
              families.set(recorded.familyId, candidate);
            }
          }
          const result = modules.engine.applyAction(state, game.actions[index], rules);
          if (!result.ok) throw new Error(`Replay ilegal (${identity}, orden ${index + 1}).`);
          state = result.state;
        }
      }
    }
    const entries = [...families.values()].sort((left, right) =>
      left.familyId.localeCompare(right.familyId),
    );
    const book = {
      format: 'hex-arena-openings-v1',
      version: 1,
      role: 'reserved-development',
      confirmatory: false,
      provenance:
        'Historical evaluation trajectories already inspected during development. This book cannot establish independent general strength.',
      createdAt: new Date().toISOString(),
      sourceInventory: { path: inventoryPath, sha256: digest(inventoryBytes) },
      selection: {
        ...options,
        criterion: options['first-reduced-after-minimum']
          ? 'First state per family at or after minimum ply with material <= threshold; ties by source identity. Never model scores or historical outcomes.'
          : 'Prefer material <= threshold, then real capture/Fortress progress, then fewer units and later prefixes; never model scores or historical outcomes.',
        maximumEntriesPerFamily: 1,
      },
      coverage: {
        sourceTrajectories: originalStateCoverage.trajectories,
        sourceFamilies: new Set([...selected.values()].map((game) => game.familyId)).size,
        selectedFamilies: entries.length,
        selectedPreferredMaterial: entries.filter(
          (entry) => entry.nonFortressUnits <= options['preferred-units'],
        ).length,
        selectedEndgames: entries.filter((entry) => entry.nonFortressUnits <= 6).length,
        selectedWithBoardProgress: entries.filter((entry) => entry.boardProgress > 0).length,
        selectedWithoutBoardProgress: entries.filter((entry) => entry.boardProgress === 0).length,
        statesWithinPrefix: originalStateCoverage.statesWithinPrefix,
        preferredStatesWithinPrefix: originalStateCoverage.preferredStatesWithinPrefix,
        preferredStatesAnywhere: originalStateCoverage.preferredStatesAnywhere,
        familiesWithPreferredAnywhere: originalStateCoverage.familiesWithPreferredAnywhere.size,
      },
      entries,
    };
    if (options.output) {
      await mkdir(dirname(resolve(options.output)), { recursive: true });
      await writeFile(resolve(options.output), `${JSON.stringify(book, null, 2)}\n`, {
        flag: 'wx',
      });
    }
    if (options.regressions) {
      const cases = createEndgameCases(modules.engine);
      const regressionBook = {
        format: 'hex-exact-regression-book-v1',
        version: 1,
        role: 'public-regression',
        confirmatory: false,
        provenance:
          'Six public engine-constructed cases, four families. Exact proof implementation and tests live in endgame-cases.mjs; no model or search is run by this export.',
        entries: cases.map((entry) => ({
          id: entry.id,
          familyId: entry.family,
          seed: entry.seed,
          initialState: entry.state,
          actions: [],
          rules: entry.rules,
          expectedWinner: entry.expectedWinner,
          proofHorizonPlies: entry.proofHorizonPlies,
          note: entry.note,
        })),
      };
      await mkdir(dirname(resolve(options.regressions)), { recursive: true });
      await writeFile(
        resolve(options.regressions),
        `${JSON.stringify(regressionBook, null, 2)}\n`,
        { flag: 'wx' },
      );
    }
    return book;
  } finally {
    if (!dependencies.modules) await modules.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2), {
    inventory: { type: 'string', required: true },
    output: { type: 'string', required: true },
    regressions: { type: 'string' },
    'maximum-prefix-plies': { type: 'number', default: 100, integer: true, min: 1, max: 2000 },
    'preferred-units': { type: 'number', default: 10, integer: true, min: 1, max: 40 },
    'first-reduced-after-minimum': { type: 'boolean', default: false },
    'minimum-state-ply': { type: 'number', default: 100, integer: true, min: 0, max: 2000 },
    seed: { type: 'number', default: 20261023, integer: true, min: 0, max: 4294967295 },
    help: { type: 'boolean', default: false },
  });
  if (options.help) {
    console.log(
      'pnpm exec node scripts/ai/reserved-openings.mjs --inventory inventario.json --output libro.json [--maximum-prefix-plies 100] [--preferred-units 10] [--regressions casos-exactos.json]\nLibro de desarrollo ya observado, no confirmación final; no ejecuta modelos ni búsquedas.',
    );
    return;
  }
  const book = await buildReservedOpenings(options);
  console.log(JSON.stringify(book.coverage));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
