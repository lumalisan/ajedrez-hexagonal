import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  freezeCampaignRuntime,
  mergeCampaignLabels,
  shardCampaignGames,
  verifyCampaignRuntime,
} from '../scripts/ai/campaign-data.mjs';

const rules = { repetition: null, noProgressPlyLimit: null };
const header = {
  kind: 'metadata',
  format: 'hexagonal-neural-dataset',
  version: 1,
  rules,
  schema: 'hex-sparse-v1',
  inputSize: 5183,
  target: 'classic-residual-v1',
  residualScale: 2000,
  labelVersion: 'bounded-outcome-v2',
  evaluationVersion: 'strategic-v2',
  sourceHashes: { teacher: 'fixed' },
};
function labels(id = 'one', familyId = 'family-one', teacher = 0.2) {
  return [
    header,
    { kind: 'game', gameId: id, familyId, rules },
    ...[0, 1].map((perspective) => ({
      kind: 'sample',
      gameId: id,
      familyId,
      ply: 3,
      perspective,
      features: [perspective + 1],
      rules,
      teacher: perspective ? -teacher : teacher,
    })),
  ];
}

describe('campaign integrity', () => {
  it('keeps entire families on one worker across source order changes', () => {
    const games = Array.from({ length: 8 }, (_, index) => ({
      kind: 'game',
      gameId: `source-${index}`,
      familyId: `family-${Math.floor(index / 2)}`,
      initialState: { unique: index },
      actions: [],
      rules,
    }));
    const assign = (entries) => {
      const shards = shardCampaignGames([header, ...entries].map(JSON.stringify).join('\n'), 3, 19);
      const mapping = new Map();
      shards.forEach((shard, index) =>
        shard.slice(1).forEach((game) => {
          if (mapping.has(game.familyId)) expect(mapping.get(game.familyId)).toBe(index);
          mapping.set(game.familyId, index);
        }),
      );
      return [...mapping].sort();
    };
    expect(assign(games)).toEqual(assign([...games].reverse()));
  });

  it('deduplicates complete perspective pairs and reports conflicting targets', () => {
    const result = mergeCampaignLabels([labels(), labels('two', 'family-two', 0.6)]);
    expect(result.summary.positions).toBe(1);
    expect(result.summary.duplicatePositions).toBe(1);
    expect(result.summary.conflictingDuplicatePositions).toBe(1);
    expect(result.summary.maximumDuplicateLabelDelta).toBeCloseTo(0.4);
    expect(result.rows.filter((row) => row.kind === 'sample')).toHaveLength(2);
  });

  it('rejects incomplete or mixed-rule perspectives and incompatible teachers', () => {
    expect(() => mergeCampaignLabels([labels().slice(0, -1)])).toThrow(/completa/);
    const mixed = JSON.parse(JSON.stringify(labels()));
    mixed[3].rules.repetition = 3;
    expect(() => mergeCampaignLabels([mixed])).toThrow(/reglas diferentes/);
    const other = JSON.parse(JSON.stringify(labels('two')));
    other[0].sourceHashes.teacher = 'changed';
    expect(() => mergeCampaignLabels([labels(), other])).toThrow(/profesores distintos/);
  });

  it('freezes sources and detects mutation without depending on the editable checkout', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'hex-campaign-snapshot-'));
    const source = join(temporary, 'source');
    const runtime = join(temporary, 'runtime');
    try {
      for (const folder of ['src', 'scripts/ai', 'tests/fixtures', 'node_modules'])
        await mkdir(join(source, folder), { recursive: true });
      for (const [file, content] of [
        ['package.json', '{}'],
        ['pnpm-lock.yaml', 'lock'],
        ['tests/fixtures/ai-strategic-positions.json', '{}'],
        ['src/engine.ts', '// original'],
      ])
        await writeFile(join(source, file), content);
      const manifest = await freezeCampaignRuntime(source, runtime);
      await writeFile(join(source, 'src/engine.ts'), '// changed working checkout');
      expect((await verifyCampaignRuntime(runtime)).sha256).toBe(manifest.sha256);
      await writeFile(join(runtime, 'src/engine.ts'), '// unexpected frozen change');
      await expect(verifyCampaignRuntime(runtime)).rejects.toThrow(/congelada/);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
