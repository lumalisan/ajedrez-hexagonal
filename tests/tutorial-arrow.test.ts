import { describe, expect, it } from 'vitest';
import { placeTutorialArrow } from '../src/rendering/tutorial-arrow';

describe('tutorial arrow placement', () => {
  const bounds = { width: 400, height: 300 };
  const target = { x: 200, y: 150 };

  it('prefers a diagonal when the surrounding space is empty', () => {
    const { start, tip } = placeTutorialArrow(target, 32, 32, bounds, []);
    expect(start.x).toBeLessThan(tip.x);
    expect(start.y).toBeLessThan(tip.y);
    expect(Math.abs(start.x - tip.x)).toBeCloseTo(Math.abs(start.y - tip.y));
  });

  it('chooses another diagonal when a unit or action cell occupies the preferred approach', () => {
    const { start, tip } = placeTutorialArrow(target, 32, 32, bounds, [
      { x: 160, y: 110, radius: 28 },
    ]);
    expect(start.x).toBeGreaterThan(tip.x);
    expect(start.y).toBeLessThan(tip.y);
  });

  it('keeps the arrow inside the viewport at its top left corner', () => {
    const { start, tip } = placeTutorialArrow({ x: 20, y: 20 }, 12, 12, bounds, []);
    for (const point of [start, tip]) {
      expect(point.x).toBeGreaterThanOrEqual(8);
      expect(point.y).toBeGreaterThanOrEqual(8);
    }
  });

  it('avoids a command label occupying the preferred diagonal', () => {
    const { start, tip } = placeTutorialArrow(
      target,
      32,
      32,
      bounds,
      [],
      [{ x: 130, y: 90, width: 65, height: 40 }],
    );
    expect(start.x).toBeGreaterThan(tip.x);
    expect(start.y).toBeLessThan(tip.y);
  });
  it('aims through a projected side midpoint at every board rotation and depth', () => {
    for (const rotation of [0, Math.PI, 0.37]) {
      for (const tilt of [1, 0.72]) {
        for (const obstacles of [[], [{ x: 160, y: 110, radius: 28 }]]) {
          const { start, tip } = placeTutorialArrow(
            target,
            32,
            32 * tilt,
            bounds,
            obstacles,
            [],
            rotation,
          );
          const midpoints = Array.from({ length: 6 }, (_, side) => {
            const a = (side * Math.PI) / 3 + rotation;
            const b = a + Math.PI / 3;
            return {
              x: (Math.cos(a) + Math.cos(b)) * 16,
              y: (Math.sin(a) + Math.sin(b)) * 16 * tilt,
            };
          });
          expect(
            midpoints.some(
              (mid) => Math.hypot(tip.x - target.x - mid.x, tip.y - target.y - mid.y) < 1e-8,
            ),
          ).toBe(true);
          expect(
            (start.x - tip.x) * (tip.y - target.y) - (start.y - tip.y) * (tip.x - target.x),
          ).toBeCloseTo(0);
        }
      }
    }
  });
});
