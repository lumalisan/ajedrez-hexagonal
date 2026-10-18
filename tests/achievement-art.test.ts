import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROGRESSION_ACHIEVEMENTS } from '../src/progression-catalog';

describe('achievement artwork', () => {
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
