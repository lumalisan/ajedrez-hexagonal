import { describe, expect, it } from 'vitest';

import { actionKey, sameAction } from '../src/action-identity';
import { createGameState } from '../src/engine';
import { analyzeImmediateThreats } from '../src/tactical-analysis';
import type { GameAction, Piece } from '../src/types';

function position(pieces: Piece[]) {
  return createGameState(
    [
      { id: 'fort-blue', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
      { id: 'fort-amber', type: 'fortress', owner: 1, position: { q: 5, r: 0 }, hp: 2 },
      ...pieces,
    ],
    0,
  );
}

describe('identidad canónica de órdenes', () => {
  it('compara por significado y distingue las variantes tácticas', () => {
    const first: GameAction = {
      kind: 'move',
      pieceId: 'tank',
      to: { q: 1, r: -1 },
      cannon: 2,
    };
    const reordered = {
      cannon: 2,
      to: { r: -1, q: 1 },
      pieceId: 'tank',
      kind: 'move',
    } as GameAction;
    const kamikaze: GameAction = { ...first, kamikaze: true };
    const airKamikaze: GameAction = { ...kamikaze, targetId: 'air-target' };
    const groundKamikaze: GameAction = { ...kamikaze, targetId: 'ground-target' };

    expect(sameAction(first, reordered)).toBe(true);
    expect(actionKey(first)).not.toBe(actionKey(kamikaze));
    expect(actionKey(airKamikaze)).not.toBe(actionKey(groundKamikaze));
  });
});

describe('análisis de amenazas inmediatas', () => {
  it('detecta capturas legales sin mutar la posición y reutiliza el análisis', () => {
    const state = position([
      { id: 'blue-soldier', type: 'soldier', owner: 0, position: { q: 0, r: 0 }, facing: 0 },
      { id: 'amber-fast', type: 'fast', owner: 1, position: { q: 0, r: 2 } },
    ]);
    const snapshot = JSON.stringify(state);

    const analysis = analyzeImmediateThreats(state);

    expect(analysis.threatenedPieceIds).toContain('blue-soldier');
    expect(analysis.threatenedCells).toContainEqual({ q: 0, r: 0 });
    expect(
      analysis.threats.some(
        (threat) =>
          threat.attackerId === 'amber-fast' &&
          threat.targetId === 'blue-soldier' &&
          threat.consequence === 'destruction',
      ),
    ).toBe(true);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(analyzeImmediateThreats(state)).toBe(analysis);
  });

  it('incluye conversiones hostiles como amenaza', () => {
    const state = position([
      { id: 'blue-soldier', type: 'soldier', owner: 0, position: { q: 0, r: 0 }, facing: 0 },
      { id: 'amber-capturer', type: 'capturer', owner: 1, position: { q: 0, r: 1 } },
    ]);

    expect(analyzeImmediateThreats(state).threats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attackerId: 'amber-capturer',
          targetId: 'blue-soldier',
          consequence: 'conversion',
        }),
      ]),
    );
  });

  it('respeta la protección antiaérea frente a disparos', () => {
    const state = position([
      { id: 'blue-soldier', type: 'soldier', owner: 0, position: { q: 0, r: 0 }, facing: 0 },
      { id: 'blue-aa', type: 'antiAir', owner: 0, position: { q: 1, r: 0 } },
      { id: 'amber-long', type: 'long', owner: 1, position: { q: 0, r: 3 } },
    ]);

    expect(analyzeImmediateThreats(state).threatenedPieceIds).not.toContain('blue-soldier');
  });

  it('considera que un Capturador adyacente amenaza la Fortaleza', () => {
    const state = createGameState(
      [
        { id: 'fort-blue', type: 'fortress', owner: 0, position: { q: 0, r: 0 }, hp: 2 },
        { id: 'fort-amber', type: 'fortress', owner: 1, position: { q: 5, r: 0 }, hp: 2 },
        { id: 'amber-capturer', type: 'capturer', owner: 1, position: { q: 0, r: 1 } },
      ],
      0,
    );

    expect(analyzeImmediateThreats(state).threatenedPieceIds).toContain('fort-blue');
    expect(
      analyzeImmediateThreats(state).threats.some((threat) => threat.targetId === 'fort-blue'),
    ).toBe(true);
  });
});
