import { describe, expect, it } from 'vitest';

import { validateState, createGameState } from '../src/engine';
import { createPresetConfig } from '../src/match-presets';

describe('match presets', () => {
  it('creates a short, symmetric and valid skirmish', () => {
    const config = createPresetConfig('skirmish', { mode: 'machine' });
    const state = createGameState(config.setup.map(({ piece }) => piece));
    expect(config.definitionId).toBe('skirmish');
    expect(config.setup).toHaveLength(18);
    expect(config.setup.filter(({ piece }) => piece.owner === 0)).toHaveLength(9);
    expect(config.setup.filter(({ piece }) => piece.owner === 1)).toHaveLength(9);
    expect(config.options.clockSeconds).toBe(600);
    expect(validateState(state, config)).toEqual([]);
  });

  it('keeps the full army for tactical and siege presets', () => {
    expect(createPresetConfig('tactical', { mode: 'local' }).setup).toHaveLength(36);
    const siege = createPresetConfig('siege', { mode: 'local' });
    expect(siege.setup).toHaveLength(36);
    expect(
      siege.setup
        .filter(({ piece }) => piece.type === 'fortress')
        .every(({ piece }) => piece.type === 'fortress' && piece.hp === 3),
    ).toBe(true);
  });
});
