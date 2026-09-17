import { describe, expect, it } from 'vitest';

import { applyAction, getLegalActionsForPiece } from '../src/engine';
import { createRuleDemoScenes, RULE_DEMO_IDS, RULE_DEMO_SCENE_LABELS } from '../src/rules-demo';

describe.each(RULE_DEMO_IDS)('demo de reglas: %s', (demoId) => {
  it('resuelve todas sus escenas mediante acciones legales del motor', () => {
    const scenes = createRuleDemoScenes(demoId);

    expect(scenes.length).toBeGreaterThanOrEqual(1);
    expect(scenes.map((scene) => scene.label)).toEqual(RULE_DEMO_SCENE_LABELS[demoId]);

    for (const scene of scenes) {
      for (const owner of [0, 1] as const) {
        expect(
          scene.state.pieces.filter((piece) => piece.type === 'fortress' && piece.owner === owner),
          `${scene.label}: Fortaleza del jugador ${owner}`,
        ).toHaveLength(1);
      }

      expect(getLegalActionsForPiece(scene.state, scene.actorId)).toContainEqual(scene.action);
      const result = applyAction(scene.state, scene.action);
      expect(result.ok, `${scene.label}: ${result.error ?? 'acción rechazada'}`).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.state.outcome).toBeNull();
      expect(result.events.map((event) => event.type)).not.toEqual(
        expect.arrayContaining(['pass', 'victory', 'draw']),
      );
    }
  });

  it('conserva las piezas entre pasos de una misma secuencia', () => {
    const scenes = createRuleDemoScenes(demoId);
    for (let index = 1; index < scenes.length; index += 1) {
      const previous = scenes[index - 1];
      const current = scenes[index];
      if (previous.sequence !== current.sequence) continue;
      expect(current.state.pieces).toEqual(
        applyAction(previous.state, previous.action).state.pieces,
      );
    }
  });
});

it('reproduce los recorridos y las dos secuencias de casillas compartidas del documento', () => {
  const soldier = createRuleDemoScenes('soldado');
  expect(soldier.map((scene) => scene.action.kind === 'move' && scene.action.to)).toEqual([
    { q: 1, r: -2 },
    { q: 1, r: -1 },
    { q: 0, r: 0 },
  ]);
  const shared = createRuleDemoScenes('casillas-compartidas');
  expect(shared.map((scene) => scene.sequence)).toEqual([0, 0, 0, 1, 1, 1, 1]);
  for (const scene of shared) {
    const after = applyAction(scene.state, scene.action).state;
    const beforeCount = scene.state.pieces.length;
    expect(after.pieces.length).toBe(beforeCount - (scene.action.kind === 'convert' ? 0 : 1));
  }
  const aircraft = createRuleDemoScenes('avion');
  const last = aircraft[aircraft.length - 1];
  const after = applyAction(last.state, last.action).state;
  expect(after.pieces.some((piece) => piece.id === 'actor' || piece.id === 'target-two')).toBe(
    false,
  );
});
