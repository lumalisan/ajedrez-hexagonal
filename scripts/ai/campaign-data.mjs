import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, symlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { canonicalJson, parseResearchInput } from './research-data.mjs';
import { fileDigest } from './research-state.mjs';
import { writeJsonCheckpoint } from './shared.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');

/** Freeze executable sources before long jobs; dependency installation stays pinned and shared. */
export async function freezeCampaignRuntime(root, destination) {
  const files = ['package.json', 'pnpm-lock.yaml', 'tests/fixtures/ai-strategic-positions.json'];
  for (const folder of ['src', 'scripts/ai']) {
    for (const path of await readdir(resolve(root, folder), { recursive: true })) {
      if (/\.(ts|tsx|mjs|py|js|json|bin)$/.test(path)) files.push(`${folder}/${path}`);
    }
  }
  const hashes = {};
  for (const file of files.sort()) hashes[file] = await fileDigest(resolve(root, file));
  await mkdir(destination, { recursive: false });
  for (const file of files) {
    const target = resolve(destination, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(root, file), target);
    if ((await fileDigest(target)) !== hashes[file])
      throw new Error(`Las fuentes cambiaron durante la copia: ${file}`);
  }
  for (const file of files) {
    if ((await fileDigest(resolve(root, file))) !== hashes[file])
      throw new Error(`Las fuentes cambiaron durante la copia: ${file}`);
  }
  await symlink(resolve(root, 'node_modules'), resolve(destination, 'node_modules'), 'junction');
  const manifest = {
    format: 'hex-campaign-runtime-v1',
    createdAt: new Date().toISOString(),
    root: resolve(destination),
    sourceRoot: resolve(root),
    files: hashes,
    sha256: digest(canonicalJson(hashes)),
    dependencyNote:
      'node_modules compartido; versiones registradas por pnpm-lock.yaml. No se instalan dependencias.',
  };
  await writeJsonCheckpoint(resolve(destination, 'snapshot.json'), manifest);
  return manifest;
}

export async function verifyCampaignRuntime(path) {
  const manifest = JSON.parse(await readFile(resolve(path, 'snapshot.json'), 'utf8'));
  if (manifest.format !== 'hex-campaign-runtime-v1') throw new Error('Snapshot incompatible.');
  if (digest(canonicalJson(manifest.files)) !== manifest.sha256)
    throw new Error('El manifiesto congelado no coincide con sus hashes.');
  for (const [file, expected] of Object.entries(manifest.files)) {
    if ((await fileDigest(resolve(path, file))) !== expected)
      throw new Error(`Una fuente congelada ha cambiado: ${file}`);
  }
  return manifest;
}

/** A family belongs to one worker, and remains a single unit in every subsequent split. */
export function shardCampaignGames(text, workers, seed = 1) {
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > 32)
    throw new Error('Número de workers inválido.');
  const games = parseResearchInput(text);
  const families = new Map();
  for (const game of games) {
    const family = game.familyId ?? `trajectory-${game.identity}`;
    const group = families.get(family) ?? [];
    group.push({ ...game, familyId: family });
    families.set(family, group);
  }
  const shards = Array.from({ length: workers }, () => []);
  const groups = [...families.entries()].sort(([left], [right]) =>
    digest(`${seed}:${left}`).localeCompare(digest(`${seed}:${right}`)),
  );
  for (const [, group] of groups) {
    const shard = shards.reduce((best, candidate) =>
      candidate.length < best.length ? candidate : best,
    );
    shard.push(...group);
  }
  return shards.map((shard) => [
    {
      kind: 'metadata',
      format: 'hexagonal-neural-dataset',
      version: 1,
      rules: 'Explicit per game; canonical families are kept together.',
    },
    ...shard.map((game) => ({
      kind: 'game',
      gameId: game.gameId,
      familyId: game.familyId,
      initialState: game.initialState,
      actions: game.actions,
      rules: game.rules,
      openingPlies: game.openingPlies ?? null,
    })),
  ]);
}

/** Merge paired labels, deduplicating whole perspective pairs before any split is chosen. */
export function mergeCampaignLabels(datasets, provenance = []) {
  let header;
  const samples = [];
  const games = new Map();
  const fingerprints = new Map();
  let duplicatePositions = 0;
  let conflictingDuplicatePositions = 0;
  let maximumDuplicateLabelDelta = 0;
  for (const rows of datasets) {
    const metadata = rows[0];
    if (!header) header = metadata;
    for (const field of [
      'schema',
      'inputSize',
      'target',
      'residualScale',
      'labelVersion',
      'evaluationVersion',
    ]) {
      if (header[field] !== metadata[field]) throw new Error(`Etiquetas incompatibles: ${field}`);
    }
    if (canonicalJson(header.sourceHashes) !== canonicalJson(metadata.sourceHashes))
      throw new Error('Los datasets proceden de profesores distintos.');
    const pairs = new Map();
    for (const row of rows.slice(1)) {
      if (row.kind === 'game') {
        const previous = games.get(row.gameId);
        if (previous && canonicalJson(previous) !== canonicalJson(row))
          throw new Error(`Partida contradictoria: ${row.gameId}`);
        games.set(row.gameId, row);
      } else if (row.kind === 'sample') {
        if (![0, 1].includes(row.perspective) || !row.familyId)
          throw new Error('Muestra sin perspectiva o familia.');
        const key = canonicalJson([row.gameId, row.ply]);
        const pair = pairs.get(key) ?? [];
        if (pair.some((other) => other.perspective === row.perspective))
          throw new Error('Perspectiva duplicada.');
        pair.push(row);
        pairs.set(key, pair);
      }
    }
    for (const pair of pairs.values()) {
      if (pair.length !== 2 || pair[0].familyId !== pair[1].familyId)
        throw new Error('Las perspectivas no forman una pareja completa de la misma familia.');
      pair.sort((a, b) => a.perspective - b.perspective);
      if (canonicalJson(pair[0].rules) !== canonicalJson(pair[1].rules))
        throw new Error('Las perspectivas usan reglas diferentes.');
      const game = games.get(pair[0].gameId);
      if (
        !game ||
        canonicalJson(game.rules) !== canonicalJson(pair[0].rules) ||
        game.familyId !== pair[0].familyId
      )
        throw new Error('La pareja no coincide con el contexto de su partida.');
      const fingerprint = digest(
        canonicalJson({
          features: pair.map((row) => [...row.features].sort((a, b) => a - b)),
          rules: pair[0].rules,
        }),
      );
      if (fingerprints.has(fingerprint)) {
        duplicatePositions += 1;
        const difference = Math.max(
          ...pair.map((row, index) => Math.abs(row.teacher - fingerprints.get(fingerprint)[index])),
        );
        maximumDuplicateLabelDelta = Math.max(maximumDuplicateLabelDelta, difference);
        if (difference > 1e-6) conflictingDuplicatePositions += 1;
        continue;
      }
      fingerprints.set(
        fingerprint,
        pair.map((row) => row.teacher),
      );
      samples.push(...pair);
    }
  }
  if (!header || !samples.length) throw new Error('No hay muestras emparejadas para entrenar.');
  return {
    rows: [
      {
        ...header,
        provenance,
        mergePolicy: 'whole-perspective-pairs; global exact-feature deduplication before split',
      },
      ...samples,
      ...games.values(),
    ],
    summary: {
      samples: samples.length,
      positions: samples.length / 2,
      duplicatePositions,
      conflictingDuplicatePositions,
      maximumDuplicateLabelDelta,
      games: new Set(samples.map((row) => row.gameId)).size,
      families: new Set(samples.map((row) => row.familyId)).size,
    },
  };
}
