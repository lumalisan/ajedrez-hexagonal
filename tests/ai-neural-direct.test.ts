import { describe, expect, it } from 'vitest';
import { searchMachineActionWithMetadata, evaluateClassicState } from '../src/ai';
import { createNeuralEvaluator, parseNeuralModel, NEURAL_INPUT_SIZE_V2 } from '../src/ai-neural';
import { applyAction, createGameState } from '../src/engine';

function directModel(overrides: Record<string, unknown> = {}, turnSignal = false): ArrayBuffer {
  const metadata = {
    format: 'hex-value-v1',
    featureSchema: 'hex-sparse-v2',
    inputSize: NEURAL_INPUT_SIZE_V2,
    hiddenSizes: [64, 32],
    outputScale: 10000,
    evaluation: 'direct-value-v1',
    residualSymmetry: 'antisymmetric',
    includesRangedValue: true,
    searchProfile: 'pvs-threats',
    ...overrides,
  };
  const header = new TextEncoder().encode(JSON.stringify(metadata));
  const offset = Math.ceil((8 + header.length) / 4) * 4;
  const parameters = NEURAL_INPUT_SIZE_V2 * 64 + 64 + 64 * 32 + 32 + 32 + 1;
  const buffer = new ArrayBuffer(offset + parameters * 4);
  new Uint8Array(buffer).set(new TextEncoder().encode('HXNN'));
  new DataView(buffer).setUint32(4, header.length, true);
  new Uint8Array(buffer, 8, header.length).set(header);
  if (turnSignal) {
    const weights = new Float32Array(buffer, offset);
    weights[5096 * 64] = 1;
    weights[5097 * 64] = 2;
    weights[NEURAL_INPUT_SIZE_V2 * 64 + 64] = 1;
    weights[NEURAL_INPUT_SIZE_V2 * 64 + 64 + 64 * 32 + 32] = 1;
  }
  return buffer;
}

function quietPosition() {
  return createGameState([
    { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 3 },
    { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 3 },
    { id: 'tank', type: 'medium', owner: 0, position: { q: 0, r: 0 }, cannon: 0 },
    { id: 's1', type: 'soldier', owner: 1, position: { q: -4, r: 4 }, facing: 0 },
  ]);
}

describe('direct zero-sum neural values', () => {
  it('returns the network value without adding a classical baseline and keeps antisymmetry', () => {
    const state = quietPosition();
    const value = createNeuralEvaluator(directModel());
    expect(evaluateClassicState(state, 0)).not.toBe(0);
    expect(value(state, 0)).toBe(0);
    expect(value(state, 1)).toBe(0);
    expect(value.includesRangedValue).toBe(true);
    expect(value.searchProfile).toBe('pvs-threats');
    const signalled = createNeuralEvaluator(directModel({}, true));
    expect(signalled(state, 0)).toBeCloseTo((Math.tanh(1) * 10000 - Math.tanh(2) * 10000) / 2, 10);
    expect(signalled(state, 0) + signalled(state, 1)).toBe(0);
  });

  it('omits only the already-included ranged value during search', () => {
    const state = quietPosition();
    const options = {
      depth: 1,
      budgetMs: 2000,
      seed: 17,
      difficulty: 'expert' as const,
      searchProfile: 'pvs-threats' as const,
    };
    const included = searchMachineActionWithMetadata(state, {
      ...options,
      evaluate: createNeuralEvaluator(directModel()),
    });
    const supplemented = searchMachineActionWithMetadata(state, { ...options, evaluate: () => 0 });
    const disabled = searchMachineActionWithMetadata(state, {
      ...options,
      evaluate: () => 0,
      rangedPlay: false,
    });
    expect(included.metadata.completedDepth).toBe(1);
    expect(included.metadata.score).toBe(0);
    expect(supplemented.metadata.score).not.toBe(0);
    expect(disabled.metadata.score).toBe(0);
  });

  it('preserves results established by the rules engine', () => {
    const state = createGameState([
      { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 3 }, hp: 1 },
      { id: 'launcher', type: 'long', owner: 0, position: { q: 0, r: 0 }, missilesRemaining: 2 },
    ]);
    const result = applyAction(state, { kind: 'shoot', pieceId: 'launcher', targetId: 'f1' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const value = createNeuralEvaluator(directModel());
    expect(result.state.outcome).toMatchObject({ type: 'win', winner: 0 });
    expect(value(result.state, 0)).toBe(evaluateClassicState(result.state, 0));
    expect(value(result.state, 0)).toBeGreaterThan(10000);
  });

  it.each([
    { includesRangedValue: false },
    { includesRangedValue: undefined },
    { residualScale: 2000 },
    { residualSymmetry: undefined },
    { evaluation: 'classic-residual-v1', residualScale: 2000 },
    { evaluation: undefined, residualSymmetry: undefined },
  ])('rejects ambiguous direct/ranged contracts: %j', (overrides) => {
    expect(() => parseNeuralModel(directModel(overrides))).toThrow('Metadatos');
  });
});
