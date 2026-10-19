import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROGRESSION_ACHIEVEMENTS } from '../src/progression-catalog';
import { UNIT_APPEARANCE } from '../src/unit-appearance';

describe('achievement artwork', () => {
  it('retains the source and official unit references for revised illustrations', () => {
    const root = new URL('../assets/achievements/hexagonal/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('generation.json', root), 'utf8')) as {
      images: Array<{ id: string; original: string; referenceUnits?: string[] }>;
    };
    expect(manifest.images.map(({ id }) => id).sort()).toEqual(
      PROGRESSION_ACHIEVEMENTS.map(({ id }) => id).sort(),
    );
    for (const entry of manifest.images) {
      expect(readFileSync(new URL(entry.original, root)).subarray(1, 4).toString()).toBe('PNG');
      for (const type of entry.referenceUnits ?? []) {
        expect(Object.hasOwn(UNIT_APPEARANCE, type), entry.id).toBe(true);
      }
    }
    for (const id of ['p1-07', 'p1-13', 'p3-17', 'p4-07', 'p4-10', 'p5-10']) {
      expect(manifest.images.find((entry) => entry.id === id)?.referenceUnits, id).toContain(
        'soldier',
      );
    }
  });

  it('provides a different generated illustration for every catalog achievement', () => {
    const directory = new URL('../public/achievements/hexagonal/', import.meta.url);
    const ids = PROGRESSION_ACHIEVEMENTS.map(({ id }) => id);
    const files = readdirSync(directory).filter((file) => file.endsWith('.webp'));
    expect(files.sort()).toEqual(ids.map((id) => `${id}.webp`).sort());
    const hashes = ids.map((id) => {
      const image = readFileSync(new URL(`${id}.webp`, directory));
      expect(image.toString('ascii', 8, 12), id).toBe('WEBP');
      return createHash('sha256').update(image).digest('hex');
    });
    expect(new Set(hashes).size).toBe(ids.length);
  });
});
