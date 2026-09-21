import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountLayoutPreview } from '../src/layout-preview';
import type { RenderModel } from '../src/renderer';
import type { Hex } from '../src/types';

const renderer = vi.hoisted(() => ({
  create: vi.fn(),
  snapToPlayer: vi.fn(),
  setDepthMode: vi.fn(),
  setFrame: vi.fn<(positions: readonly Hex[]) => void>(),
  setModel: vi.fn<(model: RenderModel) => void>(),
  destroy: vi.fn(),
}));

vi.mock('../src/renderer', () => ({
  BoardRenderer: class {
    constructor() {
      renderer.create();
    }
    snapToPlayer = renderer.snapToPlayer;
    setDepthMode = renderer.setDepthMode;
    setFrame = renderer.setFrame;
    setModel = renderer.setModel;
    destroy = renderer.destroy;
  },
}));

beforeEach(() => vi.clearAllMocks());

describe('vista previa de disposiciones', () => {
  it('conserva el encuadre de Cian en configuración y actualiza piezas sin recrear el renderer', () => {
    const canvas = {} as HTMLCanvasElement;
    const preview = mountLayoutPreview(canvas, {
      initialLayout: 1,
      fortressHp: 2,
      highContrast: false,
    });
    const first = renderer.setModel.mock.lastCall![0];
    expect(first.state.pieces).toHaveLength(18);
    expect(first.state.pieces.every((piece) => piece.owner === 0)).toBe(true);

    preview.update({ initialLayout: 5, fortressHp: 3, highContrast: true });
    const extended = renderer.setModel.mock.lastCall![0];
    expect(extended.state.pieces).toHaveLength(22);
    expect(extended.state.pieces.every((piece) => piece.owner === 0)).toBe(true);
    expect(extended.state.pieces.find((piece) => piece.type === 'fortress')).toMatchObject({
      hp: 3,
    });
    expect(extended.highContrast).toBe(true);
    expect(first.state.pieces).toHaveLength(18);
    expect(renderer.create).toHaveBeenCalledTimes(1);
    preview.destroy();
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
  });

  it('muestra ambos ejércitos completos y las 91 casillas para comparar disposiciones en el manual', () => {
    const canvas = {} as HTMLCanvasElement;
    const preview = mountLayoutPreview(canvas, {
      initialLayout: 1,
      fortressHp: 2,
      highContrast: false,
      fullBoard: true,
    });
    const classic = renderer.setModel.mock.lastCall![0];
    expect(classic.state.pieces).toHaveLength(36);
    for (const owner of [0, 1])
      expect(classic.state.pieces.filter((piece) => piece.owner === owner)).toHaveLength(18);
    const frame = renderer.setFrame.mock.lastCall![0];
    expect(new Set(frame.map(({ q, r }) => `${q},${r}`)).size).toBe(91);

    preview.update({
      initialLayout: 5,
      fortressHp: 2,
      highContrast: true,
      fullBoard: true,
    });
    const extended = renderer.setModel.mock.lastCall![0];
    expect(extended.state.pieces).toHaveLength(44);
    for (const owner of [0, 1]) {
      const army = extended.state.pieces.filter((piece) => piece.owner === owner);
      expect(army.filter((piece) => piece.type === 'soldier')).toHaveLength(11);
      expect(army.filter((piece) => piece.type === 'medium')).toHaveLength(2);
    }
    expect(renderer.setFrame.mock.lastCall![0]).toEqual(frame);
    expect(extended).toMatchObject({ reducedMotion: true, highContrast: true, actions: [] });
    expect(extended.state).toMatchObject({ ply: 0, outcome: null });
    expect(renderer.create).toHaveBeenCalledTimes(1);
    preview.destroy();
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
  });
});
