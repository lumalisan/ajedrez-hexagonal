import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createNeuralEvaluator,
  createSparseNeuralEvaluator,
  encodeNeuralFeatures,
  NEURAL_FEATURE_SCHEMA,
  NEURAL_FEATURE_SCHEMA_V2,
  NEURAL_INPUT_SIZE,
  NEURAL_INPUT_SIZE_V2,
  parseNeuralModel,
  type NeuralModel,
  type NeuralModelMetadata,
} from '../src/ai-neural';
import { createGameState, type ActionResolutionRules } from '../src/engine';

const shippedBytes = Uint8Array.from(
  readFileSync(new URL('../src/ai-models/hex-value.bin', import.meta.url)),
).buffer;

function packModel(metadata: unknown, parts: readonly Float32Array[]): ArrayBuffer {
  const header = new TextEncoder().encode(JSON.stringify(metadata));
  const offset = Math.ceil((8 + header.length) / 4) * 4;
  const count = parts.reduce((total, part) => total + part.length, 0);
  const bytes = new ArrayBuffer(offset + count * 4);
  new Uint8Array(bytes).set(new TextEncoder().encode('HXNN'));
  new DataView(bytes).setUint32(4, header.length, true);
  new Uint8Array(bytes, 8, header.length).set(header);
  const destination = new Float32Array(bytes, offset);
  let index = 0;
  for (const part of parts) {
    destination.set(part, index);
    index += part.length;
  }
  return bytes;
}

function parts(model: NeuralModel): Float32Array[] {
  return [
    model.weights1,
    model.bias1,
    model.weights2,
    model.bias2,
    model.weights3,
    Float32Array.of(model.bias3),
  ];
}

function extendWithZeroRows(model: NeuralModel): ArrayBuffer {
  const weights1 = new Float32Array(NEURAL_INPUT_SIZE_V2 * 64);
  weights1.set(model.weights1);
  const metadata: NeuralModelMetadata = {
    ...model.metadata,
    featureSchema: NEURAL_FEATURE_SCHEMA_V2,
    inputSize: NEURAL_INPUT_SIZE_V2,
  };
  return packModel(metadata, [weights1, ...parts(model).slice(1)]);
}

function position() {
  return createGameState([
    { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
    { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
    { id: 'tank', type: 'medium', owner: 0, position: { q: 1, r: 0 }, cannon: 0 },
    { id: 'plane', type: 'airplane', owner: 1, position: { q: 0, r: 2 }, facing: 0 },
  ]);
}

const enabledRules: ActionResolutionRules = {
  repetition: null,
  noProgressPlyLimit: null,
  orientationOnlyTurnLimit: 5,
};

describe('versioned orientation-rule neural features', () => {
  it('preserves the default V1 contract and every existing index before appending three V2 inputs', () => {
    const state = position();
    state.orientationOnlyTurns = [4, 2];
    const snapshot = JSON.stringify(state);
    for (const perspective of [0, 1] as const) {
      const original = encodeNeuralFeatures(state, perspective, enabledRules);
      const explicitV1 = encodeNeuralFeatures(
        state,
        perspective,
        enabledRules,
        NEURAL_FEATURE_SCHEMA,
      );
      const extended = encodeNeuralFeatures(
        state,
        perspective,
        enabledRules,
        NEURAL_FEATURE_SCHEMA_V2,
      );
      expect(explicitV1).toEqual(original);
      expect(extended.slice(0, -3)).toEqual(original);
      expect(extended).toHaveLength(original.length + 3);
      expect(new Set(extended).size).toBe(extended.length);
      expect(extended.every((feature) => feature >= 0 && feature < NEURAL_INPUT_SIZE_V2)).toBe(
        true,
      );
    }
    expect(NEURAL_FEATURE_SCHEMA).toBe('hex-sparse-v1');
    expect(NEURAL_INPUT_SIZE).toBe(5183);
    expect(NEURAL_INPUT_SIZE_V2 - NEURAL_INPUT_SIZE).toBe(20);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('distinguishes the remaining own and opponent orders, reversing those groups with perspective', () => {
    const state = position();
    state.orientationOnlyTurns = [4, 2];
    expect(
      encodeNeuralFeatures(state, 0, enabledRules, NEURAL_FEATURE_SCHEMA_V2).slice(-3),
    ).toEqual([5184, 5186, 5197]);
    expect(
      encodeNeuralFeatures(state, 1, enabledRules, NEURAL_FEATURE_SCHEMA_V2).slice(-3),
    ).toEqual([5184, 5188, 5195]);
    // The previously indistinguishable near-forfeit position now has a different V2 vector.
    const before = encodeNeuralFeatures(state, 0, enabledRules);
    state.orientationOnlyTurns = [3, 2];
    expect(encodeNeuralFeatures(state, 0, enabledRules)).toEqual(before);
    expect(
      encodeNeuralFeatures(state, 0, enabledRules, NEURAL_FEATURE_SCHEMA_V2).slice(-3),
    ).toEqual([5184, 5187, 5197]);
  });

  it('disables both remaining-order groups for a missing or null limit, even with existing counters', () => {
    const state = position();
    state.orientationOnlyTurns = [4, 7];
    for (const rules of [
      { repetition: null, noProgressPlyLimit: null },
      { repetition: null, noProgressPlyLimit: null, orientationOnlyTurnLimit: null },
    ]) {
      expect(encodeNeuralFeatures(state, 0, rules, NEURAL_FEATURE_SCHEMA_V2).slice(-3)).toEqual([
        5183, 5185, 5194,
      ]);
      expect(encodeNeuralFeatures(state, 1, rules, NEURAL_FEATURE_SCHEMA_V2).slice(-3)).toEqual([
        5183, 5185, 5194,
      ]);
    }
  });

  it('defaults absent counters to zero and clips remaining orders to the exact 0..7,>=8 buckets', () => {
    const state = position();
    expect(
      encodeNeuralFeatures(state, 0, enabledRules, NEURAL_FEATURE_SCHEMA_V2).slice(-3),
    ).toEqual([5184, 5190, 5199]);
    const highLimit = { ...enabledRules, orientationOnlyTurnLimit: 20 };
    state.orientationOnlyTurns = [13, 0];
    expect(encodeNeuralFeatures(state, 0, highLimit, NEURAL_FEATURE_SCHEMA_V2).slice(-3)).toEqual([
      5184, 5192, 5202,
    ]);
    state.orientationOnlyTurns = [12, 20];
    expect(encodeNeuralFeatures(state, 0, highLimit, NEURAL_FEATURE_SCHEMA_V2).slice(-3)).toEqual([
      5184, 5193, 5194,
    ]);
    state.orientationOnlyTurns = [23, 0];
    expect(encodeNeuralFeatures(state, 0, highLimit, NEURAL_FEATURE_SCHEMA_V2).slice(-3)).toEqual([
      5184, 5185, 5202,
    ]);
  });
});

describe('HXNN schema compatibility', () => {
  it('keeps the shipped V1 model and all its Python parity vectors intact', () => {
    const model = parseNeuralModel(shippedBytes);
    if (model.metadata.featureSchema !== NEURAL_FEATURE_SCHEMA)
      throw new Error('El modelo distribuido debe seguir siendo V1.');
    const size: typeof NEURAL_INPUT_SIZE = model.metadata.inputSize;
    expect(size).toBe(5183);
    expect(model.weights1).toHaveLength(5183 * 64);
    const evaluate = createSparseNeuralEvaluator(shippedBytes);
    const parity: { vectors: { features: number[]; expectedScore: number }[] } = JSON.parse(
      readFileSync(new URL('../src/ai-models/hex-value.bin.parity.json', import.meta.url), 'utf8'),
    );
    expect(parity.vectors).toHaveLength(16);
    for (const vector of parity.vectors)
      expect(evaluate(vector.features)).toBeCloseTo(vector.expectedScore, 8);
  });

  it('produces exactly the same V1 values when the twenty new V2 weight rows are zero', () => {
    const originalModel = parseNeuralModel(shippedBytes);
    const extendedBytes = extendWithZeroRows(originalModel);
    const extendedModel = parseNeuralModel(extendedBytes);
    if (extendedModel.metadata.featureSchema !== NEURAL_FEATURE_SCHEMA_V2)
      throw new Error('Se esperaba V2.');
    const size: typeof NEURAL_INPUT_SIZE_V2 = extendedModel.metadata.inputSize;
    expect(size).toBe(5203);
    expect(extendedModel.weights1.slice(0, originalModel.weights1.length)).toEqual(
      originalModel.weights1,
    );
    expect(
      extendedModel.weights1.slice(originalModel.weights1.length).every((weight) => weight === 0),
    ).toBe(true);
    const original = createNeuralEvaluator(shippedBytes);
    const extended = createNeuralEvaluator(extendedBytes);
    const state = position();
    for (const rules of [
      enabledRules,
      { ...enabledRules, orientationOnlyTurnLimit: null },
      { ...enabledRules, orientationOnlyTurnLimit: 20 },
    ]) {
      for (const counters of [
        [0, 0],
        [4, 1],
        [6, 8],
      ] as const) {
        state.orientationOnlyTurns = [...counters];
        for (const player of [0, 1] as const)
          expect(extended(state, player, rules)).toBe(original(state, player, rules));
      }
    }
    expect(extended.searchProfile).toBe(original.searchProfile);
  });

  it('automatically uses a V2 model schema during position inference and validates its own input range', () => {
    const metadata: NeuralModelMetadata = {
      format: 'hex-value-v1',
      featureSchema: NEURAL_FEATURE_SCHEMA_V2,
      inputSize: NEURAL_INPUT_SIZE_V2,
      hiddenSizes: [64, 32],
      outputScale: 10000,
    };
    const weights1 = new Float32Array(NEURAL_INPUT_SIZE_V2 * 64);
    weights1[5186 * 64] = 1; // Exactly one own orientation-only order remains.
    const weights2 = new Float32Array(64 * 32);
    weights2[0] = 1;
    const weights3 = new Float32Array(32);
    weights3[0] = 0.25;
    const bytes = packModel(metadata, [
      weights1,
      new Float32Array(64),
      weights2,
      new Float32Array(32),
      weights3,
      new Float32Array(1),
    ]);
    const evaluate = createNeuralEvaluator(bytes);
    const sparse = createSparseNeuralEvaluator(bytes);
    const state = position();
    state.orientationOnlyTurns = [4, 0];
    expect(evaluate(state, 0, enabledRules)).toBe(Math.tanh(0.25) * 10000);
    expect(evaluate(state, 1, enabledRules)).toBe(0);
    state.orientationOnlyTurns = [3, 0];
    expect(evaluate(state, 0, enabledRules)).toBe(0);
    expect(sparse([5202])).toBe(0);
    for (const invalid of [-1, 5203, 5203.5, Number.NaN])
      expect(() => sparse([invalid])).toThrow('Índice de entrada');
    expect(() => createSparseNeuralEvaluator(shippedBytes)([5183])).toThrow('Índice de entrada');
  });

  it.each([
    { featureSchema: NEURAL_FEATURE_SCHEMA, inputSize: NEURAL_INPUT_SIZE_V2 },
    { featureSchema: NEURAL_FEATURE_SCHEMA_V2, inputSize: NEURAL_INPUT_SIZE },
    { featureSchema: NEURAL_FEATURE_SCHEMA_V2, inputSize: NEURAL_INPUT_SIZE_V2 + 1 },
    { featureSchema: 'hex-sparse-v3', inputSize: NEURAL_INPUT_SIZE_V2 },
  ])('rejects mismatched schema/dimension metadata %j', (override) => {
    const model = parseNeuralModel(shippedBytes);
    expect(() =>
      parseNeuralModel(packModel({ ...model.metadata, ...override }, parts(model))),
    ).toThrow('Metadatos');
  });

  it('does not accept V1-sized weight bytes behind an otherwise valid V2 header', () => {
    const model = parseNeuralModel(shippedBytes);
    expect(() =>
      parseNeuralModel(
        packModel(
          {
            ...model.metadata,
            featureSchema: NEURAL_FEATURE_SCHEMA_V2,
            inputSize: NEURAL_INPUT_SIZE_V2,
          },
          parts(model),
        ),
      ),
    ).toThrow('Tamaño de pesos');
  });
});
