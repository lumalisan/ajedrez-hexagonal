import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSparseNeuralEvaluator, parseNeuralModel } from '../src/ai-neural';

describe('shipped experimental neural artifact', () => {
  it('loads the trained candidate and reproduces the held-out Python vectors', () => {
    const source = readFileSync(new URL('../src/ai-models/hex-value.bin', import.meta.url));
    const bytes = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    const metadata = parseNeuralModel(bytes).metadata;
    const parity: {
      featureSchema: string;
      vectors: { features: number[]; expectedScore: number }[];
    } = JSON.parse(
      readFileSync(new URL('../src/ai-models/hex-value.bin.parity.json', import.meta.url), 'utf8'),
    );
    expect(metadata.training?.samples).toBeGreaterThan(0);
    expect(parity.featureSchema).toBe(metadata.featureSchema);
    expect(parity.vectors.length).toBeGreaterThan(0);
    const evaluate = createSparseNeuralEvaluator(bytes);
    for (const vector of parity.vectors) {
      expect(evaluate(vector.features)).toBeCloseTo(vector.expectedScore, 7);
    }
  });
});
