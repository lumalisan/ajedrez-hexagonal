import { describe, expect, it } from 'vitest';

import {
  createNeuralEvaluator,
  createSparseNeuralEvaluator,
  encodeNeuralFeatures,
  NEURAL_FEATURE_SCHEMA,
  NEURAL_INPUT_SIZE,
  parseNeuralModel,
} from '../src/ai-neural';
import { allBoardHexes } from '../src/hex';
import type { Direction, GameState, Piece, Player } from '../src/types';
import { evaluateClassicState } from '../src/ai';

const cells = allBoardHexes();
const boardFeatures = 91 * 2 * 28;
const parameters = NEURAL_INPUT_SIZE * 64 + 64 + 64 * 32 + 32 + 32 + 1;
const offsets = {
  bias1: NEURAL_INPUT_SIZE * 64,
  weights2: NEURAL_INPUT_SIZE * 64 + 64,
  bias2: NEURAL_INPUT_SIZE * 64 + 64 + 64 * 32,
  weights3: NEURAL_INPUT_SIZE * 64 + 64 + 64 * 32 + 32,
  bias3: parameters - 1,
};
type PieceProperties<T = Piece> = T extends Piece ? Omit<T, 'id' | 'owner' | 'position'> : never;

function stateWith(pieces: Piece[] = []): GameState {
  return {
    pieces,
    activePlayer: 0,
    firstFortressDamageBy: null,
    noProgressPlyCount: 0,
    ply: 0,
    positionCounts: {},
    history: [],
    outcome: null,
  };
}

function modelBytes(
  initialize?: (weights: Float32Array) => void,
  metadataOverrides: Record<string, unknown> = {},
): ArrayBuffer {
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      format: 'hex-value-v1',
      featureSchema: NEURAL_FEATURE_SCHEMA,
      inputSize: NEURAL_INPUT_SIZE,
      hiddenSizes: [64, 32],
      outputScale: 10_000,
      training: { seed: 7 },
      ...metadataOverrides,
    }),
  );
  const weightOffset = Math.ceil((8 + metadata.length) / 4) * 4;
  const bytes = new ArrayBuffer(weightOffset + parameters * 4);
  new Uint8Array(bytes).set(new TextEncoder().encode('HXNN'));
  new DataView(bytes).setUint32(4, metadata.length, true);
  new Uint8Array(bytes, 8, metadata.length).set(metadata);
  initialize?.(new Float32Array(bytes, weightOffset));
  return bytes;
}

function variants(owner: Player): Piece[] {
  const pieces: Piece[] = [];
  function add(properties: PieceProperties) {
    pieces.push({
      ...properties,
      id: `piece-${pieces.length}`,
      owner,
      position: { ...cells[pieces.length] },
    });
  }
  for (const facing of [0, 1, 2, 3, 4, 5] as const) add({ type: 'soldier', facing });
  add({ type: 'capturer' });
  for (const cannon of [0, 1, 2, 3, 4, 5] as const) add({ type: 'medium', cannon });
  for (const missilesRemaining of [0, 1, 2] as const) add({ type: 'long', missilesRemaining });
  add({ type: 'fast' });
  add({ type: 'drone' });
  for (const facing of [0, 1, 2, 3, 4, 5] as const) add({ type: 'airplane', facing });
  add({ type: 'antiAir' });
  for (const hp of [1, 2, 3] as const) add({ type: 'fortress', hp });
  return pieces;
}

function rotateAndSwap(piece: Piece): Piece {
  const rotated: Piece = {
    ...piece,
    owner: piece.owner === 0 ? 1 : 0,
    position: { q: -piece.position.q, r: -piece.position.r },
  };
  if (rotated.type === 'soldier' || rotated.type === 'airplane')
    rotated.facing = ((rotated.facing + 3) % 6) as Direction;
  if (rotated.type === 'medium') rotated.cannon = ((rotated.cannon + 3) % 6) as Direction;
  return rotated;
}

describe('sparse neural position features', () => {
  it.each([0, 1] as const)('encodes all 28 piece variants for owner %i', (owner) => {
    const state = stateWith(variants(owner));
    const features = encodeNeuralFeatures(state, 0);

    expect(features.slice(0, 28)).toEqual(
      Array.from({ length: 28 }, (_, variant) => (owner * 91 + variant) * 28 + variant),
    );
    expect(new Set(features).size).toBe(features.length);
    expect(features.every((index) => Number.isInteger(index) && index < NEURAL_INPUT_SIZE)).toBe(
      true,
    );
  });

  it('preserves both ground and air units sharing a cell, including legacy ammunition', () => {
    const state = stateWith([
      { id: 'long', type: 'long', owner: 0, position: { q: 0, r: 0 } },
      { id: 'air', type: 'drone', owner: 1, position: { q: 0, r: 0 } },
    ]);
    const center = cells.findIndex((cell) => cell.q === 0 && cell.r === 0);

    expect(encodeNeuralFeatures(state, 0).slice(0, 2)).toEqual([
      center * 28 + 15,
      (91 + center) * 28 + 17,
    ]);
    state.pieces[0] = { ...state.pieces[0], type: 'long', missilesRemaining: 2 };
    expect(encodeNeuralFeatures(state, 0).slice(0, 2)[0]).toBe(center * 28 + 15);
  });

  it('canonicalizes ownership, coordinates and every orientation for the other perspective', () => {
    const state = stateWith([...variants(0), ...variants(1)]);
    state.activePlayer = 1;
    state.firstFortressDamageBy = 0;
    state.positionCounts = { a: 2, b: 1 };
    state.ply = 71;
    state.noProgressPlyCount = 65;
    const mirrored: GameState = {
      ...state,
      pieces: state.pieces.map(rotateAndSwap),
      activePlayer: 0,
      firstFortressDamageBy: 1,
    };
    const snapshot = JSON.stringify([state, mirrored]);

    expect(encodeNeuralFeatures(state, 0)).toEqual(encodeNeuralFeatures(mirrored, 1));
    expect(JSON.stringify([state, mirrored])).toBe(snapshot);
  });

  it('encodes rule settings and counters in bounded, distinct global groups', () => {
    const state = stateWith();
    state.positionCounts = { a: 1, b: 2, c: 3 };
    state.firstFortressDamageBy = 1;
    state.activePlayer = 1;
    state.noProgressPlyCount = 119;
    state.ply = 32;

    expect(encodeNeuralFeatures(state, 0)).toEqual([
      5097, // Enemy turn.
      5100, // Enemy dealt the first damage.
      5115, // 119 / 8, bucket 14.
      5121, // Maximum repetition saturates at 3.
      5124, // Two historical positions have repeated.
      5139, // Repetition draws disabled.
      5148, // No-progress draws disabled.
      5168, // Ply / 16, bucket 2.
    ]);
    expect(
      encodeNeuralFeatures(state, 0, { repetition: null, noProgressPlyLimit: null }).slice(5, 7),
    ).toEqual([5139, 5148]);
    state.positionCounts = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`p${i}`, 50]));
    state.noProgressPlyCount = 100_000;
    state.ply = 100_000;
    expect(encodeNeuralFeatures(state, 0, { repetition: 99, noProgressPlyLimit: 100_000 })).toEqual(
      [5097, 5100, 5117, 5121, 5138, 5147, 5165, 5182],
    );
    delete state.noProgressPlyCount;
    expect(encodeNeuralFeatures(state, 0)[2]).toBe(5101);
  });

  it('ignores presentation and piece identifiers, and rejects off-board cells', () => {
    const state = stateWith(variants(0));
    const before = encodeNeuralFeatures(state, 0);
    for (const piece of state.pieces) piece.id = `renamed-${piece.id}`;
    state.history.push({ id: 1, player: 1, text: 'Texto de presentación' });
    state.outcome = { type: 'draw', reason: 'repetition' };
    expect(encodeNeuralFeatures(state, 0)).toEqual(before);
    state.pieces[0].position = { q: 5, r: 5 };
    expect(() => encodeNeuralFeatures(state, 0)).toThrow(/fuera del tablero/);
  });
});

describe('neural model loading and synchronous inference', () => {
  it('projects residuals onto a zero-sum value and removes a perspective-independent bias', () => {
    const state = stateWith(variants(0).slice(0, 2));
    const before = structuredClone(state);
    const bytes = modelBytes(
      (weights) => {
        weights[boardFeatures * 64] = 2;
        weights[offsets.weights2] = 1;
        weights[offsets.weights3] = 0.5;
        weights[offsets.bias3] = 0.3;
      },
      {
        evaluation: 'classic-residual-v1',
        residualScale: 2000,
        residualSymmetry: 'antisymmetric',
        searchProfile: 'pvs-threats',
      },
    );
    const evaluate = createNeuralEvaluator(bytes);
    const expectedCorrection = (Math.tanh(1.3) - Math.tanh(0.3)) * 1000;
    expect(evaluate(state, 0)).toBeCloseTo(evaluateClassicState(state, 0) + expectedCorrection, 4);
    expect(evaluate(state, 0) + evaluate(state, 1)).toBeCloseTo(0, 10);
    expect(evaluate.searchProfile).toBe('pvs-threats');
    const constant = createNeuralEvaluator(
      modelBytes(
        (weights) => {
          weights[offsets.bias3] = 0.5;
        },
        {
          evaluation: 'classic-residual-v1',
          residualScale: 2000,
          residualSymmetry: 'antisymmetric',
        },
      ),
    );
    expect(constant(state, 0)).toBe(evaluateClassicState(state, 0));
    expect(state).toEqual(before);
  });
  it('adds a bounded learned residual while preserving the classical prior', () => {
    const state = stateWith(variants(0).slice(0, 2));
    const baseline = evaluateClassicState(state, 0);
    const bytes = modelBytes(
      (weights) => {
        weights[offsets.bias3] = 0.5;
      },
      {
        evaluation: 'classic-residual-v1',
        residualScale: 2000,
        searchProfile: 'pvs-history',
      },
    );
    const evaluate = createNeuralEvaluator(bytes);
    expect(evaluate(state, 0)).toBeCloseTo(baseline + Math.tanh(0.5) * 2000, 8);
    expect(evaluate.searchProfile).toBe('pvs-history');
    expect(
      createNeuralEvaluator(
        modelBytes(undefined, {
          evaluation: 'classic-residual-v1',
          residualScale: 2000,
        }),
      )(state, 0),
    ).toBe(baseline);
  });
  it('calculates a sparse MLP through both ReLUs and the scaled tanh', () => {
    const state = stateWith();
    const before = JSON.stringify(state);
    const bytes = modelBytes((weights) => {
      weights[boardFeatures * 64] = 2; // Own turn activates hidden1[0].
      weights[(boardFeatures + 1) * 64] = 4; // Enemy turn contributes more.
      weights[offsets.bias1] = -0.5;
      weights[offsets.bias1 + 1] = -2; // ReLU removes this neuron.
      weights[offsets.weights2] = 0.5;
      weights[offsets.weights2 + 32] = 50;
      weights[offsets.bias2] = -0.25;
      weights[offsets.bias2 + 1] = -10; // Second ReLU also matters.
      weights[offsets.weights3] = 0.5;
      weights[offsets.weights3 + 1] = 50;
      weights[offsets.bias3] = 0.125;
    });
    const evaluate = createNeuralEvaluator(bytes);
    const evaluateFeatures = createSparseNeuralEvaluator(bytes);

    expect(evaluate(state, 0)).toBeCloseTo(Math.tanh(0.375) * 10_000, 8);
    expect(evaluateFeatures(encodeNeuralFeatures(state, 0))).toBe(evaluate(state, 0));
    expect(evaluate(state, 1)).toBeCloseTo(Math.tanh(0.875) * 10_000, 8);
    expect(evaluate(state, 0)).toBeCloseTo(Math.tanh(0.375) * 10_000, 8);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('rejects indices outside the versioned feature schema', () => {
    const evaluate = createSparseNeuralEvaluator(modelBytes());
    for (const feature of [-1, NEURAL_INPUT_SIZE, 1.5, Number.NaN]) {
      expect(() => evaluate([feature])).toThrow(/Índice de entrada/);
    }
  });

  it('passes custom resolution rules into the features used for evaluation', () => {
    const bytes = modelBytes((weights) => {
      weights[5139 * 64] = 0.5; // Only disabled repetition.
      weights[offsets.weights2] = 1;
      weights[offsets.weights3] = 1;
    });
    const evaluate = createNeuralEvaluator(bytes);
    expect(evaluate(stateWith(), 0, { repetition: 3, noProgressPlyLimit: 120 })).toBe(0);
    expect(evaluate(stateWith(), 0, { repetition: null, noProgressPlyLimit: null })).toBeCloseTo(
      Math.tanh(0.5) * 10_000,
      8,
    );
  });

  it('owns parsed weights and produces finite scores below mate even for huge finite weights', () => {
    const bytes = modelBytes((weights) => weights.fill(3e38));
    const evaluate = createNeuralEvaluator(bytes);
    const parsed = parseNeuralModel(bytes);
    expect(parsed.metadata.training).toEqual({ seed: 7 });
    expect(parsed.weights1.length).toBe(NEURAL_INPUT_SIZE * 64);
    expect(parsed.bias3).toBe(Math.fround(3e38));
    new Uint8Array(bytes).fill(0);
    const score = evaluate(stateWith(), 0);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBe(10_000);
    expect(Math.abs(score)).toBeLessThan(1_000_000);
    expect(Number.isFinite(parsed.weights1[0])).toBe(true);
  });

  it.each([
    { format: 'other' },
    { featureSchema: 'future-schema' },
    { inputSize: NEURAL_INPUT_SIZE + 1 },
    { hiddenSizes: [128, 32] },
    { hiddenSizes: [64, 32, 1] },
    { hiddenSizes: null },
    { outputScale: 1_000_000 },
    { training: [] },
    { training: null },
    { evaluation: 'unknown' },
    { evaluation: 'classic-residual-v1' },
    { evaluation: 'classic-residual-v1', residualScale: -1 },
    { evaluation: 'classic-residual-v1', residualScale: 5001 },
    { searchProfile: 'unknown' },
    { residualSymmetry: 'antisymmetric' },
    { evaluation: 'classic-residual-v1', residualScale: 2000, residualSymmetry: 'unknown' },
  ])('rejects incompatible metadata %j', (metadata) => {
    expect(() => parseNeuralModel(modelBytes(undefined, metadata))).toThrow(/Metadatos/);
  });

  it('rejects corrupt headers, metadata lengths, JSON, padding, truncated and extra weights', () => {
    expect(() => parseNeuralModel(new ArrayBuffer(0))).toThrow(/Cabecera/);
    const badHeader = modelBytes();
    new Uint8Array(badHeader)[0] = 0;
    expect(() => parseNeuralModel(badHeader)).toThrow(/Cabecera/);
    const badLength = modelBytes();
    new DataView(badLength).setUint32(4, 0xffff_ffff, true);
    expect(() => parseNeuralModel(badLength)).toThrow(/Longitud/);
    const badJson = modelBytes();
    new Uint8Array(badJson)[8] = 0xff;
    expect(() => parseNeuralModel(badJson)).toThrow(/JSON/);
    const badPadding = modelBytes(undefined, { paddingTest: '' });
    const metadataLength = new DataView(badPadding).getUint32(4, true);
    expect((metadataLength + 8) % 4).not.toBe(0);
    new Uint8Array(badPadding)[metadataLength + 8] = 1;
    expect(() => parseNeuralModel(badPadding)).toThrow(/Relleno/);
    const complete = modelBytes();
    expect(() => parseNeuralModel(complete.slice(0, -4))).toThrow(/Tamaño/);
    const oversized = new Uint8Array(complete.byteLength + 4);
    oversized.set(new Uint8Array(complete));
    expect(() => parseNeuralModel(oversized.buffer)).toThrow(/Tamaño/);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite parameters (%s), including the final output bias',
    (value) => {
      expect(() => parseNeuralModel(modelBytes((weights) => (weights[0] = value)))).toThrow(
        /no finitos/,
      );
      expect(() =>
        parseNeuralModel(modelBytes((weights) => (weights[offsets.bias3] = value))),
      ).toThrow(/no finitos/);
    },
  );
});
