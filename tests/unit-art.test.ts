import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PIECE_NAMES } from '../src/engine';
import { RULE_SECTIONS } from '../src/rules-content';
import { RULE_UNIT_APPEARANCES, UNIT_APPEARANCE } from '../src/unit-appearance';

describe('referencias oficiales de las unidades', () => {
  it('entrega una ilustración distinta para cada tipo del motor y la hace accesible en el manual', () => {
    const directory = new URL('../public/units/', import.meta.url);
    const types = Object.keys(PIECE_NAMES);
    expect(Object.keys(UNIT_APPEARANCE).sort()).toEqual(types.sort());
    expect(
      readdirSync(directory)
        .filter((file) => file.endsWith('.webp'))
        .sort(),
    ).toEqual(types.map((type) => `${type}.webp`).sort());
    const hashes = types.map((type) => {
      const image = readFileSync(new URL(`${type}.webp`, directory));
      expect(image.toString('ascii', 8, 12), type).toBe('WEBP');
      return createHash('sha256').update(image).digest('hex');
    });
    expect(new Set(hashes).size).toBe(types.length);
    expect(Object.values(RULE_UNIT_APPEARANCES).flat().sort()).toEqual(types.sort());
    for (const id of Object.keys(RULE_UNIT_APPEARANCES)) {
      expect(
        RULE_SECTIONS.some((section) => section.id === id),
        id,
      ).toBe(true);
    }
  });

  it('conserva los originales y los prompts utilizados para generar las referencias', () => {
    const root = new URL('../assets/units/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('generation.json', root), 'utf8')) as {
      units: Array<{ type: string; original: string; prompt: string }>;
    };
    expect(manifest.units.map(({ type }) => type).sort()).toEqual(Object.keys(PIECE_NAMES).sort());
    for (const unit of manifest.units) {
      expect(unit.prompt.length).toBeGreaterThan(100);
      expect(readFileSync(new URL(unit.original, root)).subarray(1, 4).toString()).toBe('PNG');
    }
  });
});
