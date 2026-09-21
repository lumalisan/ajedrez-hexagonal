import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferImageSource, Container, FillGradient, Graphics, Texture } from 'pixi.js';
import { PixiPiece, type PixiPieceOptions } from '../src/rendering/pixi-piece';
import type { Piece } from '../src/types';

const options: PixiPieceOptions = {
  selected: false,
  highContrast: false,
  alpha: 1,
  orientation: 0,
  depth: 0,
};

const nodes: PixiPiece[] = [];

beforeEach(() => {
  // A buffer stands in for Pixi's tiny gradient canvas; scene geometry stays real.
  vi.spyOn(FillGradient.prototype, 'buildGradient').mockImplementation(function (
    this: FillGradient,
  ) {
    this.texture ??= new Texture({
      source: new BufferImageSource({
        resource: new Uint8Array([255, 255, 255, 255]),
        width: 1,
        height: 1,
      }),
    });
  });
});

afterEach(() => {
  for (const node of nodes.splice(0)) node.destroy();
  vi.restoreAllMocks();
});

function pieceNode(piece: Piece, settings = options): PixiPiece {
  const node = new PixiPiece();
  nodes.push(node);
  node.update(piece, settings);
  return node;
}

function child(parent: Container, label: string): Container {
  const found = parent.getChildByLabel(label, true);
  if (!found) throw new Error(`Falta la parte visual: ${label}`);
  return found;
}

describe('piezas Pixi retenidas', () => {
  it('aplica cámara, elevación y opacidad sin reconstruir la geometría ni mover el anclaje', () => {
    const piece: Piece = {
      id: 'air',
      type: 'airplane',
      owner: 0,
      facing: 2,
      position: { q: 0, r: 0 },
    };
    const node = pieceNode(piece);
    node.position.set(123, 456);
    const glyph = child(node, 'glyph-airplane');
    const clear = vi.spyOn(Graphics.prototype, 'clear');
    node.update(piece, {
      ...options,
      depth: 1,
      orientation: Math.PI,
      glyphRotation: 0.2,
      alpha: 0.4,
    });
    expect(node.position).toMatchObject({ x: 123, y: 456 });
    expect(child(node, 'piece-token').y).toBe(-27);
    expect(child(node, 'piece-air-ring').visible).toBe(true);
    expect(node.alpha).toBe(0.4);
    expect(glyph.rotation).toBeCloseTo(Math.PI + 0.2 - Math.PI / 2 + (2 * Math.PI) / 3);
    expect(clear).not.toHaveBeenCalled();
  });

  it('anima las hélices por transformaciones y vuelve a quietud al omitir idleTime', () => {
    const piece: Piece = { id: 'drone', type: 'drone', owner: 0, position: { q: 0, r: 0 } };
    const node = pieceNode(piece);
    const rotor = child(node, 'drone-rotor-7-7');
    const marks = child(node, 'piece-owner-health');
    const clear = vi.spyOn(Graphics.prototype, 'clear');
    node.update(piece, { ...options, idleTime: 100 });
    const firstRotation = rotor.rotation;
    node.update(piece, { ...options, idleTime: 500 });
    expect(rotor.rotation).not.toBe(firstRotation);
    expect(child(node, 'drone-rotor-7-7')).toBe(rotor);
    expect(marks.position).toMatchObject({ x: 0, y: 0 });
    node.update(piece, options);
    expect(rotor.rotation).toBe(0);
    expect(child(node, 'piece-glyph-motion').position).toMatchObject({ x: 0, y: 0 });
    expect(clear).not.toHaveBeenCalled();
  });

  it('retira misiles gastados sin reconstruir el glifo y actualiza cambio de bando', () => {
    const piece: Piece = { id: 'launcher', type: 'long', owner: 0, position: { q: 0, r: 0 } };
    const node = pieceNode(piece);
    const glyph = child(node, 'glyph-long');
    const clear = vi.spyOn(Graphics.prototype, 'clear');
    node.update({ ...piece, missilesRemaining: 1 }, options);
    expect(child(node, 'missile-0').visible).toBe(true);
    expect(child(node, 'missile-1').visible).toBe(false);
    expect(child(node, 'glyph-long')).toBe(glyph);
    expect(clear).not.toHaveBeenCalled();
    node.update({ ...piece, owner: 1 }, options);
    expect(glyph.destroyed).toBe(true);
    expect(child(node, 'glyph-long').rotation).toBe(-Math.PI / 2);
    expect(child(node, 'piece-token').y).toBe(0);
    expect(child(node, 'piece-air-ring').visible).toBe(false);
  });

  it('libera geometría y el gradiente compartido solo al destruir su último usuario', () => {
    const piece: Piece = {
      id: 'soldier',
      type: 'soldier',
      owner: 0,
      facing: 0,
      position: { q: 0, r: 0 },
    };
    const first = pieceNode(piece, { ...options, depth: 1 });
    const second = pieceNode({ ...piece, id: 'second' });
    const glyph = child(first, 'glyph-soldier');
    const destroyGradient = vi.spyOn(FillGradient.prototype, 'destroy');
    expect(child(first, 'piece-token').y).toBe(-4);
    first.destroy();
    expect(glyph.destroyed).toBe(true);
    expect(destroyGradient).not.toHaveBeenCalled();
    second.update(piece, { ...options, selected: true });
    second.destroy();
    expect(destroyGradient).toHaveBeenCalledTimes(1);
    first.destroy();
    second.destroy();
    expect(destroyGradient).toHaveBeenCalledTimes(1);
  });
});
