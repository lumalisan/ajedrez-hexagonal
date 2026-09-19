import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyAction, getAllLegalActions, validateState } from '../src/engine';
import { createClassicConfig, validateMatchConfig } from '../src/game-config';
import { hexKey } from '../src/hex';
import {
  appendAction,
  createMatchRecord,
  parseRecord,
  replayRecord,
  resolutionRulesForConfig,
  serializeRecord,
} from '../src/match-record';
import { loadActiveMatch, saveActiveMatch } from '../src/match-storage';
import { createInitialPieces } from '../src/setup';
import { installMemoryStorage } from './helpers/memory-storage';

describe('disposiciones iniciales', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { initialLayout: 3, outerFront: 'medium' },
    { initialLayout: 4, outerFront: 'soldier' },
  ] as const)(
    'reproduce las posiciones de la imagen en la disposición $initialLayout',
    ({ initialLayout, outerFront }) => {
      const cyan = createInitialPieces(2, initialLayout).filter((piece) => piece.owner === 0);

      // Coordenadas del mundo: la vista Cian gira el tablero y muestra q > 0 a la izquierda.
      expect(Object.fromEntries(cyan.map((piece) => [hexKey(piece.position), piece.type]))).toEqual(
        {
          '4,-4': 'soldier',
          '2,-3': 'soldier',
          '0,-2': 'soldier',
          '-2,-1': 'soldier',
          '-4,0': 'soldier',
          '3,-4': outerFront,
          '1,-3': 'medium',
          '-1,-2': 'medium',
          '-3,-1': outerFront,
          '4,-5': 'fast',
          '0,-3': 'capturer',
          '-4,-1': 'fast',
          '2,-5': 'drone',
          '0,-4': 'fortress',
          '-2,-3': 'drone',
          '1,-5': 'long',
          '-1,-4': 'airplane',
          '0,-5': 'antiAir',
        },
      );
      expect(cyan).toHaveLength(18);
    },
  );

  it.each([1, 2, 3, 4] as const)(
    'mantiene la disposición %i válida y simétrica con cualquier vida de Fortaleza',
    (initialLayout) => {
      for (const fortressHp of [1, 2, 3] as const) {
        const config = createClassicConfig({ mode: 'local', initialLayout, fortressHp });
        const state = createMatchRecord(config).initialState;

        expect(validateMatchConfig(config)).toEqual([]);
        expect(validateState(state, config)).toEqual([]);
        expect(state.pieces).toHaveLength(36);
        expect(new Set(state.pieces.map((piece) => piece.id)).size).toBe(36);
        expect(new Set(state.pieces.map((piece) => hexKey(piece.position))).size).toBe(36);

        for (const cyan of state.pieces.filter((piece) => piece.owner === 0)) {
          const amber = state.pieces.find(
            (piece) =>
              piece.owner === 1 &&
              piece.position.q === -cyan.position.q &&
              piece.position.r === -cyan.position.r,
          );
          expect(amber?.type, hexKey(cyan.position)).toBe(cyan.type);
        }

        for (const piece of state.pieces) {
          if (piece.type === 'soldier' || piece.type === 'airplane')
            expect(piece.facing).toBe(piece.owner === 0 ? 3 : 0);
          if (piece.type === 'medium') expect(piece.cannon).toBe(piece.owner === 0 ? 3 : 0);
          if (piece.type === 'fortress') expect(piece.hp).toBe(fortressHp);
        }
      }
    },
  );

  it('conserva la disposición clásica como opción predeterminada', () => {
    expect(createInitialPieces()).toEqual(createInitialPieces(2, 1));
    expect(createClassicConfig({ mode: 'local' }).setup).toEqual(
      createClassicConfig({ mode: 'local', initialLayout: 1 }).setup,
    );
  });

  it.each([3, 4] as const)(
    'guarda, importa y reproduce una partida legal con la disposición %i',
    (initialLayout) => {
      installMemoryStorage();
      const config = createClassicConfig({ mode: 'local', initialLayout });
      const initialRecord = createMatchRecord(config);
      let record = initialRecord;
      let expectedState = structuredClone(initialRecord.initialState);

      for (let ply = 0; ply < 6; ply += 1) {
        const action = getAllLegalActions(expectedState).find(
          (candidate) => candidate.kind === 'move',
        );
        expect(action).toBeDefined();
        if (!action) throw new Error('La disposición debe permitir continuar la partida.');
        const result = applyAction(expectedState, action, resolutionRulesForConfig(config));
        expect(result.ok).toBe(true);
        expectedState = result.state;
        record = appendAction(record, action);
      }

      expect(saveActiveMatch(record)).toBe(true);
      const restored = loadActiveMatch();
      expect(restored.error).toBeUndefined();
      expect(restored.record).toEqual(record);
      if (!restored.record) throw new Error('La partida guardada debe poder recuperarse.');

      const imported = parseRecord(serializeRecord(restored.record));
      expect(imported.config.setup).toEqual(config.setup);
      expect(replayRecord(imported, 0)).toEqual(initialRecord.initialState);
      expect(replayRecord(imported)).toEqual(expectedState);
      expect(validateState(expectedState, config)).toEqual([]);
      expect(initialRecord.actions).toEqual([]);
    },
  );
});
