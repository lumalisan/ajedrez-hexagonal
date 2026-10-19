import { describe, expect, it } from 'vitest';
import { RepetitionHasher } from '../src/ai-position';

function referenceHash(counts: Record<string, number>): number {
  let value = 0;
  for (const [key, count] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    for (let index = 0; index < key.length; index += 1) {
      value = (value * 31 + key.charCodeAt(index)) | 0;
    }
    value = (value * 31 + count) | 0;
  }
  return value;
}

describe('bounded repetition hash acceleration', () => {
  it('matches the original identity across long histories, counts and insertion orders', () => {
    const hasher = new RepetitionHasher();
    const counts: Record<string, number> = {};
    for (let index = 0; index < 80; index += 1) {
      counts[`turn-${index}:${'fortress:soldier:drone:'.repeat(30)}`] = (index % 3) + 1;
      expect(hasher.hash(counts)).toBe(referenceHash(counts));
    }
    const reversed = Object.fromEntries(Object.entries(counts).reverse());
    expect(hasher.hash(reversed)).toBe(referenceHash(counts));
    counts[Object.keys(counts)[0]] += 1;
    expect(hasher.hash(counts)).toBe(referenceHash(counts));
    expect(hasher.hash({})).toBe(0);
    expect(hasher.hash({ 'Ámbar-🛩': 2, Cian: 1 })).toBe(referenceHash({ 'Ámbar-🛩': 2, Cian: 1 }));
  });

  it('continues to compute identical keys after its bounded cache fills', () => {
    const hasher = new RepetitionHasher();
    const counts = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`position-${i}`, 1]));
    expect(hasher.hash(counts)).toBe(referenceHash(counts));
    counts['position-4999'] = 3;
    expect(hasher.hash(counts)).toBe(referenceHash(counts));
  });
});
