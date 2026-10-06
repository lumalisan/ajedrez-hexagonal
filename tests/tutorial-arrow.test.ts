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
});
