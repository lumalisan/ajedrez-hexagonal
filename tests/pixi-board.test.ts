import { BufferImageSource, Container, FillGradient, Graphics, Texture } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAction, createGameState, getLegalActionsForPiece } from '../src/engine';
import { PixiBoard, type BoardAnimation } from '../src/rendering/pixi-board';
import { PixiPiece } from '../src/rendering/pixi-piece';
import type { RenderModel } from '../src/rendering/model';
import type { GameAction, GameState, Piece } from '../src/types';

const scenes: { scene: PixiBoard; stage: Container }[] = [];
const view = {
  width: 800,
  height: 600,
  x: 400,
  y: 300,
  scale: 1,
  zoom: 1,
  orientation: 0,
  depth: 0,
  frame: null,
};

beforeEach(() => {
  // Only gradient rasterization needs a browser; all scene geometry remains real.
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
  for (const { scene, stage } of scenes.splice(0)) {
    scene.destroy();
    stage.destroy({ children: true, context: true });
  }
  vi.restoreAllMocks();
});

function position(extra: Piece[]): GameState {
  return createGameState([
    { id: 'blue-fort', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
    { id: 'amber-fort', type: 'fortress', owner: 1, position: { q: 0, r: -2 }, hp: 2 },
    ...extra,
  ]);
}

function modelFor(state: GameState): RenderModel {
  return {
    state,
    fortressMaxHp: [2, 2],
    selectedId: null,
    actions: [],
    pending: null,
    hovered: null,
    focused: null,
    firingRange: [],
    lastEvents: [],
    threatenedCells: [],
    reducedMotion: false,
    highContrast: false,
  };
}

function board(state: GameState): { scene: PixiBoard; stage: Container } {
  const stage = new Container();
  const scene = new PixiBoard(stage);
  scenes.push({ scene, stage });
  scene.update(modelFor(state), 0, view, null);
  return { scene, stage };
}

function child(parent: Container, label: string): Container {
  const found = parent.getChildByLabel(label, true);
  if (!found) throw new Error(`Falta el nodo de escena: ${label}`);
  return found;
}

/** Visit in Pixi's painting order, including its deferred zIndex sorting. */
function paintOrder(parent: Container): Container[] {
  if (parent.sortableChildren) parent.sortChildren();
  return parent.children.flatMap((node) => [node, ...paintOrder(node)]);
}

function resolve(
  before: GameState,
  id: string,
  matches: (action: GameAction) => boolean,
): { state: GameState; animation: BoardAnimation } {
  const action = getLegalActionsForPiece(before, id).find(matches);
  if (!action) throw new Error('La posición debe permitir la acción de la prueba.');
  const result = applyAction(before, action);
  expect(result.ok).toBe(true);
  return {
    state: result.state,
    animation: { before, events: result.events, startedAt: 0, duration: 1000 },
  };
}

describe('integración de la escena Pixi', () => {
  it.each([
    { orientation: 0, depth: 0 },
    { orientation: Math.PI, depth: 0 },
    { orientation: 0, depth: 1 },
    { orientation: Math.PI, depth: 1 },
  ])('pinta aire sobre tierra en una casilla compartida ($orientation, $depth)', (camera) => {
    const state = position([
      { id: 'air', type: 'drone', owner: 0, position: { q: 1, r: 0 } },
      { id: 'ground', type: 'soldier', owner: 0, position: { q: 1, r: 0 }, facing: 0 },
    ]);
    const { scene, stage } = board(state);
    scene.update(modelFor(state), 100, { ...view, ...camera }, null);
    const ground = child(stage, 'piece-ground');
    const air = child(stage, 'piece-air');
    const order = paintOrder(stage);

    expect(ground.y).toBeGreaterThan(air.y);
    expect(order.indexOf(air)).toBeGreaterThan(order.indexOf(ground));
  });

  it('pinta el impacto encima de una captura y devuelve al superviviente a su capa estable', () => {
    const before = position([
      { id: 'attacker', type: 'soldier', owner: 0, position: { q: 0, r: 0 }, facing: 0 },
      { id: 'target', type: 'soldier', owner: 1, position: { q: 0, r: -1 }, facing: 3 },
    ]);
    const { scene, stage } = board(before);
    const attacker = child(stage, 'piece-attacker');
    const target = child(stage, 'piece-target');
    const settledLayer = attacker.parent;
    const { state, animation } = resolve(
      before,
      'attacker',
      (action) => action.kind === 'move' && action.to.q === 0 && action.to.r === -1,
    );

    scene.update(modelFor(state), 850, view, animation);
    const order = paintOrder(stage);
    const impact = order.find(
      (node) =>
        node instanceof Graphics &&
        node.context.instructions.some(
          (instruction) =>
            instruction.action === 'stroke' && instruction.data.style.color === 0xff174f,
        ),
    );
    expect(impact).toBeDefined();
    expect(order.indexOf(impact!)).toBeGreaterThan(order.indexOf(attacker));
    expect(child(stage, 'piece-attacker')).toBe(attacker);
    expect(attacker.parent).not.toBe(settledLayer);
    expect(target.destroyed).toBe(true);

    scene.update(modelFor(state), 1000, view, null);
    expect(attacker.parent).toBe(settledLayer);
    expect(paintOrder(stage).filter((node) => node instanceof PixiPiece)).toHaveLength(
      state.pieces.length,
    );
    expect((impact as Graphics).context.instructions).toHaveLength(0);
  });

  it('mantiene el atacante sacrificado durante el impacto y libera su nodo al finalizar', () => {
    const before = position([
      { id: 'attacker', type: 'soldier', owner: 0, position: { q: 0, r: -1 }, facing: 0 },
    ]);
    const { scene, stage } = board(before);
    const attacker = child(stage, 'piece-attacker');
    const glyph = child(attacker, 'glyph-soldier');
    const { state, animation } = resolve(
      before,
      'attacker',
      (action) => action.kind === 'move' && action.to.q === 0 && action.to.r === -2,
    );
    expect(state.pieces.some((piece) => piece.id === 'attacker')).toBe(false);

    scene.update(modelFor(state), 875, view, animation);
    expect(child(stage, 'piece-attacker')).toBe(attacker);
    expect(attacker.alpha).toBeGreaterThan(0);
    expect(attacker.alpha).toBeLessThan(1);

    scene.update(modelFor(state), 1000, view, null);
    expect(stage.getChildByLabel('piece-attacker', true)).toBeNull();
    expect(attacker.destroyed).toBe(true);
    expect(glyph.destroyed).toBe(true);
    expect(paintOrder(stage).filter((node) => node instanceof PixiPiece)).toHaveLength(
      state.pieces.length,
    );
  });

  it('transforma y desplaza el mismo nodo sin conservar el glifo anterior ni duplicar piezas', () => {
    const before = position([
      { id: 'vehicle', type: 'medium', owner: 0, position: { q: 0, r: 0 }, cannon: 0 },
    ]);
    const { scene, stage } = board(before);
    const vehicle = child(stage, 'piece-vehicle');
    const oldGlyph = child(vehicle, 'glyph-medium');
    const settledLayer = vehicle.parent;
    const { state, animation } = resolve(
      before,
      'vehicle',
      (action) =>
        action.kind === 'transform' &&
        action.facing === 0 &&
        action.to?.q === 0 &&
        action.to.r === -1,
    );

    scene.update(modelFor(state), 500, view, animation);
    expect(child(stage, 'piece-vehicle')).toBe(vehicle);
    expect(child(vehicle, 'glyph-soldier')).toBeDefined();
    expect(oldGlyph.destroyed).toBe(true);
    expect(vehicle.parent).not.toBe(settledLayer);

    scene.update(modelFor(state), 1000, view, null);
    expect(vehicle.parent).toBe(settledLayer);
    expect(paintOrder(stage).filter((node) => node instanceof PixiPiece)).toHaveLength(
      state.pieces.length,
    );
    expect(stage.getChildByLabel('glyph-medium', true)).toBeNull();
  });
});
