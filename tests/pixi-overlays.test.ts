import { Container, Graphics } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { createGameState, getLegalActionsForPiece } from '../src/engine';
import { hexToWorld } from '../src/hex';
import { projectHex, type RenderModel } from '../src/rendering/model';
import { PixiOverlays } from '../src/rendering/pixi-overlays';
import { createRuleDemoScenes } from '../src/rules-demo';
import type { GameState, Piece } from '../src/types';

function position(extra: Piece[] = []): GameState {
  return createGameState([
    { id: 'blue-fort', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
    { id: 'amber-fort', type: 'fortress', owner: 1, position: { q: 5, r: 0 }, hp: 2 },
    { id: 'soldier', type: 'soldier', owner: 0, position: { q: 0, r: 0 }, facing: 0 },
    ...extra,
  ]);
}

function modelFor(state: GameState): RenderModel {
  const action = getLegalActionsForPiece(state, 'soldier').find(
    (candidate) => candidate.kind === 'move' && candidate.to.q === 0 && candidate.to.r === -1,
  );
  if (!action) throw new Error('The test position must allow the soldier to advance.');
  return {
    state,
    fortressMaxHp: [2, 2],
    selectedId: 'soldier',
    actions: [action],
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

function graphicsIn(container: Container): Graphics[] {
  return container.children.flatMap((child) =>
    child instanceof Graphics ? [child] : graphicsIn(child),
  );
}

describe('overlays tácticos nativos de Pixi', () => {
  it('selecciona el destino previsto del Dron antes de su intercepción en la demo', () => {
    const overlays = new PixiOverlays();
    const scene = createRuleDemoScenes('fortaleza')[2];
    const model: RenderModel = {
      ...modelFor(position()),
      state: scene.state,
      selectedId: scene.actorId,
      actions: getLegalActionsForPiece(scene.state, scene.actorId),
      pending: scene.action,
      pendingDestination: scene.intendedDestination,
    };
    try {
      overlays.update(model, 0, Math.PI, 0);
      const selection = overlays.board.getChildByLabel('pending-destination')!;
      expect(selection.visible).toBe(true);
      expect(selection.position).toMatchObject(hexToWorld({ q: 0, r: 5 }));

      overlays.update({ ...model, pendingDestination: null }, 100, Math.PI, 0);
      expect(selection.position).toMatchObject(hexToWorld({ q: 1, r: 4 }));

      overlays.update({ ...model, pending: null }, 200, Math.PI, 0);
      expect(selection.visible).toBe(false);
    } finally {
      overlays.destroy();
    }
  });

  it('anima los indicadores sin reconstruir su geometría ni crear nodos por fotograma', () => {
    const overlays = new PixiOverlays();
    const model = modelFor(position());
    try {
      overlays.update(model, 0, Math.PI, 0);
      const graphics = graphicsIn(overlays.board);
      const geometryUpdated = vi.fn();
      for (const graphic of graphics) graphic.context.on('update', geometryUpdated);
      const fill = graphics.find((graphic) => graphic.tint.toString(16) === '55e0c1');
      const firstAlpha = fill?.alpha;

      overlays.update(model, 360, Math.PI, 0);

      expect(graphicsIn(overlays.board)).toEqual(graphics);
      expect(geometryUpdated).not.toHaveBeenCalled();
      expect(firstAlpha).toBeDefined();
      expect(fill?.alpha).not.toBe(firstAlpha);
    } finally {
      overlays.destroy();
    }
  });

  it('muestra movimiento por encima de una unidad amiga de la otra capa y proyecta su posición', () => {
    const overlays = new PixiOverlays();
    const model = modelFor(
      position([{ id: 'drone', type: 'drone', owner: 0, position: { q: 0, r: -1 } }]),
    );
    try {
      overlays.update(model, 0, Math.PI, 0);
      const visible = overlays.targets.children.filter((target) => target.visible);
      expect(visible).toHaveLength(1);
      const target = visible[0];
      const expected = projectHex({ q: 0, r: -1 }, Math.PI, 0);
      expect(target.position.x).toBeCloseTo(expected.x);
      expect(target.position.y).toBeCloseTo(expected.y);

      overlays.update(model, 0, 0, 1);

      const tilted = projectHex({ q: 0, r: -1 }, 0, 1);
      expect(overlays.targets.children.find((candidate) => candidate.visible)).toBe(target);
      expect(target.position.x).toBeCloseTo(tilted.x);
      expect(target.position.y).toBeCloseTo(tilted.y);
    } finally {
      overlays.destroy();
    }
  });

  it('reutiliza los indicadores al cancelar y volver a seleccionar, respetando movimiento reducido', () => {
    const overlays = new PixiOverlays();
    const model = modelFor(position());
    model.reducedMotion = true;
    try {
      overlays.update(model, 0, 0, 0);
      const graphics = graphicsIn(overlays.board);
      const geometryUpdated = vi.fn();
      for (const graphic of graphics) graphic.context.on('update', geometryUpdated);
      const markerLayer = overlays.board.getChildByLabel('action-markers');
      expect(markerLayer?.children).toHaveLength(1);
      const marker = markerLayer?.children[0];
      const firstAlpha = graphics.map((graphic) => graphic.alpha);
      const firstScales = graphics.map((graphic) => [graphic.scale.x, graphic.scale.y]);

      overlays.update(model, 200, 0, 0);
      expect(graphics.map((graphic) => graphic.alpha)).toEqual(firstAlpha);
      expect(graphics.map((graphic) => [graphic.scale.x, graphic.scale.y])).toEqual(firstScales);
      overlays.update({ ...model, actions: [] }, 300, 0, 0);
      expect(marker?.visible).toBe(false);
      overlays.update(model, 400, 0, 0);

      expect(markerLayer?.children).toHaveLength(1);
      expect(markerLayer?.children[0]).toBe(marker);
      expect(marker?.visible).toBe(true);
      expect(geometryUpdated).not.toHaveBeenCalled();
    } finally {
      overlays.destroy();
    }
  });

  it('retira los marcadores superiores cuando desaparecen los objetivos y libera ambas ramas', () => {
    const overlays = new PixiOverlays();
    const model = modelFor(
      position([{ id: 'enemy', type: 'soldier', owner: 1, position: { q: 0, r: -1 }, facing: 3 }]),
    );
    overlays.update(model, 0, 0, 0);
    expect(overlays.targets.children.filter((target) => target.visible)).toHaveLength(1);
    const graphics = [...graphicsIn(overlays.board), ...graphicsIn(overlays.targets)];
    const contexts = graphics.map((graphic) => graphic.context);

    overlays.update({ ...model, selectedId: null, actions: [] }, 100, 0, 0);
    expect(overlays.targets.children.every((target) => !target.visible)).toBe(true);
    overlays.destroy();
    overlays.destroy();

    expect(overlays.board.destroyed).toBe(true);
    expect(overlays.targets.destroyed).toBe(true);
    expect(graphics.every((graphic) => graphic.destroyed)).toBe(true);
    expect(contexts.every((context) => context.destroyed)).toBe(true);
    expect(() => overlays.update(model, 200, 0, 0)).not.toThrow();
  });
});
