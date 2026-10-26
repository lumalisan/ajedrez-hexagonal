import { describe, expect, it } from 'vitest';
import { evaluateClassicState } from '../src/ai';
import {
  createNeuralEvaluator,
  evaluateNeuralMaterialBaseline,
  NEURAL_INPUT_SIZE_V2,
  NEURAL_MATERIAL_BASELINE,
  parseNeuralModel,
} from '../src/ai-neural';
import { applyAction, createGameState } from '../src/engine';
import type { Piece } from '../src/types';

function materialModel(overrides: Record<string, unknown> = {}, turnSignal = false): ArrayBuffer {
  const metadata = {
    format: 'hex-value-v1',
    featureSchema: 'hex-sparse-v2',
    inputSize: NEURAL_INPUT_SIZE_V2,
    hiddenSizes: [64, 32],
    outputScale: 10000,
    evaluation: 'material-residual-v1',
    residualScale: 2000,
    residualBaseline: NEURAL_MATERIAL_BASELINE,
    residualSymmetry: 'antisymmetric',
    includesRangedValue: true,
    searchProfile: 'pvs-threats',
    ...overrides,
  };
  const header = new TextEncoder().encode(JSON.stringify(metadata));
  const offset = Math.ceil((8 + header.length) / 4) * 4;
  const parameters = NEURAL_INPUT_SIZE_V2 * 64 + 64 + 64 * 32 + 32 + 32 + 1;
  const bytes = new ArrayBuffer(offset + parameters * 4);
  new Uint8Array(bytes).set(new TextEncoder().encode('HXNN'));
  new DataView(bytes).setUint32(4, header.length, true);
  new Uint8Array(bytes, 8, header.length).set(header);
  if (turnSignal) {
    const weights = new Float32Array(bytes, offset);
    weights[5096 * 64] = 1;
    weights[5097 * 64] = 2;
    weights[NEURAL_INPUT_SIZE_V2 * 64 + 64] = 1;
    weights[NEURAL_INPUT_SIZE_V2 * 64 + 64 + 64 * 32 + 32] = 1;
  }
  return bytes;
}

function position() {
  return createGameState([
    { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 3 },
    { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 3 }, hp: 1 },
    { id: 'l0', type: 'long', owner: 0, position: { q: 0, r: 0 }, missilesRemaining: 2 },
    { id: 'l1', type: 'long', owner: 1, position: { q: 1, r: 0 }, missilesRemaining: 0 },
    { id: 'a0', type: 'airplane', owner: 0, position: { q: 0, r: 0 }, facing: 0 },
  ]);
}

describe('versioned material residual network', () => {
  const common = { id: 'additional', owner: 0 as const, position: { q: -4, r: 4 } };
  const contracts = [
    { piece: { ...common, type: 'soldier', facing: 0 }, value: 100 },
    { piece: { ...common, type: 'capturer' }, value: 320 },
    { piece: { ...common, type: 'medium', cannon: 0 }, value: 420 },
    { piece: { ...common, type: 'long', missilesRemaining: 1 }, value: 340 },
    { piece: { ...common, type: 'fast' }, value: 850 },
    { piece: { ...common, type: 'drone' }, value: 450 },
    { piece: { ...common, type: 'airplane', facing: 0 }, value: 860 },
    { piece: { ...common, type: 'antiAir' }, value: 300 },
  ] satisfies Array<{ piece: Piece; value: number }>;
  it.each(contracts)(
    'preserves the versioned material contract: $piece.type',
    ({ piece, value }) => {
      const state = createGameState([...position().pieces, piece]);
      expect(evaluateNeuralMaterialBaseline(state, 0)).toBe(16180 + value);
      expect(evaluateNeuralMaterialBaseline(state, 1)).toBe(-16180 - value);
    },
  );
  it('keeps material and fortress values outside the output bound, without mutating the state', () => {
    const state = position();
    const before = JSON.stringify(state);
    const value = createNeuralEvaluator(materialModel());
    // 2 HP*7500 + (400+100) -180 + (700+160).
    expect(evaluateNeuralMaterialBaseline(state, 0)).toBe(16180);
    expect(value(state, 0)).toBe(16180);
    expect(value(state, 1)).toBe(-16180);
    expect(value.includesRangedValue).toBe(true);
    expect(value.searchProfile).toBe('pvs-threats');
    expect(JSON.stringify(state)).toBe(before);
  });

  it('scales the projected correction exactly once and preserves zero sum', () => {
    const state = position();
    const value = createNeuralEvaluator(materialModel({}, true));
    const correction = ((Math.tanh(1) - Math.tanh(2)) / 2) * 2000;
    expect(value(state, 0)).toBeCloseTo(16180 + correction, 10);
    expect(value(state, 0) + value(state, 1)).toBe(0);
    const moved = {
      ...state,
      pieces: state.pieces.map((piece) =>
        piece.id === 'l0' ? { ...piece, position: { q: -1, r: 1 } } : piece,
      ),
    };
    expect(evaluateNeuralMaterialBaseline(moved, 0)).toBe(16180);
  });

  it('uses exact engine terminal values instead of its material estimate', () => {
    const result = applyAction(position(), { kind: 'shoot', pieceId: 'l0', targetId: 'f1' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.state.outcome).toMatchObject({ type: 'win', winner: 0 });
    const value = createNeuralEvaluator(materialModel());
    expect(value(result.state, 0)).toBe(evaluateClassicState(result.state, 0));
    expect(value(result.state, 0)).toBeGreaterThan(100000);
  });

  it.each([
    { residualBaseline: undefined },
    { residualBaseline: 42 },
    { residualBaseline: 'material-fortress-v2' },
    { residualScale: undefined },
    { residualScale: 0 },
    { residualScale: 5001 },
    { includesRangedValue: undefined },
    { includesRangedValue: false },
    { residualSymmetry: undefined },
    { evaluation: 'classic-residual-v1' },
    { evaluation: 'direct-value-v1' },
  ])('rejects incompatible material contracts: %j', (overrides) => {
    expect(() => parseNeuralModel(materialModel(overrides))).toThrow('Metadatos');
  });
});
