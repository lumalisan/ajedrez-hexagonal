import { describe, expect, it } from 'vitest';
import { actionMarkers, movementPose, type RenderModel } from '../src/rendering/model';
import { createRuleDemoScenes } from '../src/rules-demo';
import { applyAction, getLegalActionsForPiece } from '../src/engine';

describe('movimiento visual', () => {
  it.each(['soldier', 'airplane'] as const)(
    '%s gira antes de avanzar y mantiene el rumbo durante el avance',
    (type) => {
      const piece = {
        id: 'actor',
        type,
        owner: 0 as const,
        position: { q: 0, r: 0 },
        facing: 0 as const,
      };
      const to = { q: 1, r: -1 };
      expect(movementPose(piece, piece.position, to, 0.1).travel).toBe(0);
      expect(movementPose(piece, piece.position, to, 0.1).rotation).toBeGreaterThan(0);
      expect(movementPose(piece, piece.position, to, 0.25)).toEqual({
        travel: 0,
        rotation: Math.PI / 3,
      });
      expect(movementPose(piece, piece.position, to, 0.5).travel).toBeGreaterThan(0);
      expect(movementPose(piece, piece.position, to, 1)).toEqual({
        travel: 1,
        rotation: Math.PI / 3,
      });
      expect(piece.facing).toBe(0);
      expect(
        movementPose({ ...piece, facing: 5 }, piece.position, { q: 0, r: -1 }, 0.25).rotation,
      ).toBeCloseTo(Math.PI / 3);
    },
  );
  it('el Tanque avanza sin girar el cañón durante el recorrido', () => {
    const piece = {
      id: 'tank',
      type: 'medium' as const,
      owner: 0 as const,
      position: { q: 0, r: 0 },
      cannon: 0 as const,
    };
    expect(movementPose(piece, piece.position, { q: 1, r: -1 }, 0.1).travel).toBeGreaterThan(0);
    expect(movementPose(piece, piece.position, { q: 1, r: -1 }, 1).rotation).toBe(0);
  });
});

it.each([
  'soldado',
  'tanque',
  'lanzamisiles',
  'embestidor',
  'casillas-compartidas',
  'capturador',
] as const)('solo la captura de bando muestra una red: %s', (id) => {
  for (const scene of createRuleDemoScenes(id)) {
    const model: RenderModel = {
      state: scene.state,
      fortressMaxHp: [2, 2],
      selectedId: scene.actorId,
      actions: getLegalActionsForPiece(scene.state, scene.actorId),
      pending: null,
      hovered: null,
      focused: null,
      firingRange: [],
      lastEvents: [],
      threatenedCells: [],
      reducedMotion: false,
      highContrast: false,
    };
    const nets = [...actionMarkers(model).values()].filter((marker) => marker.kind === 'convert');
    const actor = scene.state.pieces.find((piece) => piece.id === scene.actorId)!;
    if (actor.type !== 'capturer') expect(nets).toHaveLength(0);
    else if (scene.action.kind === 'convert') expect(nets.length).toBeGreaterThan(0);
  }
});

it('la Fortaleza cae tras dos avances y el Dron es interceptado en el borde del escudo', () => {
  const scenes = createRuleDemoScenes('fortaleza');
  expect(scenes.map((scene) => scene.sequence)).toEqual([0, 0, 1]);
  expect(scenes[0].state.pieces.find((piece) => piece.id === 'actor')).toMatchObject({
    position: { q: 0, r: 2 },
    facing: 3,
  });
  const impact = applyAction(scenes[1].state, scenes[1].action);
  expect(impact.state.pieces.some((piece) => ['actor', 'fort-amber'].includes(piece.id))).toBe(
    false,
  );
  const intercept = applyAction(scenes[2].state, scenes[2].action);
  expect(scenes[2].state.pieces.find((piece) => piece.id === 'actor')?.position).toEqual({
    q: 3,
    r: 2,
  });
  expect(intercept.events).toContainEqual(
    expect.objectContaining({ type: 'intercept', at: { q: 1, r: 4 } }),
  );
  expect(intercept.state.pieces.some((piece) => piece.id === 'actor')).toBe(false);
  expect(intercept.state.pieces.some((piece) => piece.id === 'anti-air')).toBe(true);
});
