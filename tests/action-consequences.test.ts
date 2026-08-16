import { describe, expect, it } from 'vitest';

import { analyzeActionConsequences } from '../src/action-consequences';
import { createGameState, getLegalActionsForPiece } from '../src/engine';
import type { Piece } from '../src/types';

const fortresses: Piece[] = [
  { id: 'blue-fortress', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
  { id: 'amber-fortress', type: 'fortress', owner: 1, position: { q: 5, r: 0 }, hp: 2 },
];

describe('action consequence lens', () => {
  it('describes a deterministic capture', () => {
    const state = createGameState([
      ...fortresses,
      { id: 'blue', type: 'soldier', owner: 0, position: { q: 0, r: 0 }, facing: 0 },
      { id: 'amber', type: 'soldier', owner: 1, position: { q: 0, r: -1 }, facing: 3 },
    ]);
    const action = getLegalActionsForPiece(state, 'blue').find(
      (candidate) => candidate.kind === 'move' && candidate.to.q === 0 && candidate.to.r === -1,
    );
    expect(action).toBeDefined();
    const consequence = analyzeActionConsequences(state, action!);
    expect(consequence.ok).toBe(true);
    expect(consequence.captured.map((piece) => piece.id)).toEqual(['amber']);
    expect(consequence.summaries.join(' ')).toContain('Neutralizas Soldado');
  });

  it('reports newly exposed pieces without predicting intent', () => {
    const state = createGameState([
      ...fortresses,
      { id: 'blue', type: 'soldier', owner: 0, position: { q: 0, r: 0 }, facing: 0 },
      { id: 'amber-long', type: 'long', owner: 1, position: { q: 0, r: -4 } },
    ]);
    const action = getLegalActionsForPiece(state, 'blue').find(
      (candidate) => candidate.kind === 'move' && candidate.to.q === 0 && candidate.to.r === -1,
    );
    expect(action).toBeDefined();
    const consequence = analyzeActionConsequences(state, action!);
    expect(consequence.newlyThreatened.map((piece) => piece.id)).toContain('blue');
    expect(consequence.summaries.join(' ')).toContain('amenaza inmediata');
  });

  it('uses the match rules supplied by the caller', () => {
    const state = createGameState([
      ...fortresses,
      { id: 'blue', type: 'soldier', owner: 0, position: { q: 0, r: 0 }, facing: 0 },
      { id: 'amber', type: 'soldier', owner: 1, position: { q: 2, r: 0 }, facing: 3 },
    ]);
    state.noProgressPlyCount = 1;
    const action = getLegalActionsForPiece(state, 'blue').find(
      (candidate) => candidate.kind === 'rotate',
    );
    expect(action).toBeDefined();

    const consequence = analyzeActionConsequences(state, action!, {
      repetition: null,
      noProgressPlyLimit: 2,
    });

    expect(consequence.outcomeLabel).toBe('La batalla termina en tablas.');
  });
});
