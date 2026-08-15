import { describe, expect, it } from 'vitest';

import { applyAction, getLegalActionsForPiece } from '../src/engine';
import { createRuleDemoScenes, RULE_DEMO_IDS, RULE_DEMO_SCENE_LABELS } from '../src/rules-demo';

describe.each(RULE_DEMO_IDS)('demo de reglas: %s', (demoId) => {
  it('resuelve todas sus escenas mediante acciones legales del motor', () => {
    const scenes = createRuleDemoScenes(demoId);

    expect(scenes.length).toBeGreaterThanOrEqual(1);
    expect(scenes.length).toBeLessThanOrEqual(3);
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
});
