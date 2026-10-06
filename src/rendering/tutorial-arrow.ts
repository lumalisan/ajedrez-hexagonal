export interface ArrowPoint {
  x: number;
  y: number;
}
export interface ArrowObstacle extends ArrowPoint {
  radius: number;
}
export interface ArrowRectangle extends ArrowPoint {
  width: number;
  height: number;
}

/** Prefer a clear diagonal approach; shorten before covering useful board content. */
export function placeTutorialArrow(
  target: ArrowPoint,
  radiusX: number,
  radiusY: number,
  bounds: { width: number; height: number },
  obstacles: readonly ArrowObstacle[],
  rectangles: readonly ArrowRectangle[] = [],
): { start: ArrowPoint; tip: ArrowPoint } {
  const directions = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  let best: { start: ArrowPoint; tip: ArrowPoint; score: number } | undefined;
  for (const length of [38, 26, 18])
    for (const [dx, dy] of directions) {
      const norm = Math.hypot(dx, dy);
      const ux = dx / norm;
      const uy = dy / norm;
      const tip = { x: target.x + ux * radiusX, y: target.y + uy * radiusY };
      const start = { x: tip.x + ux * length, y: tip.y + uy * length };
      let score = (38 - length) / 38 + (dx === 0 || dy === 0 ? 2 : 0);
      for (const point of [tip, start]) {
        if (point.x < 8 || point.x > bounds.width - 8 || point.y < 8 || point.y > bounds.height - 8)
          score += 1000;
      }
      const vx = start.x - tip.x;
      const vy = start.y - tip.y;
      for (const obstacle of obstacles) {
        const t = Math.max(
          0,
          Math.min(
            1,
            ((obstacle.x - tip.x) * vx + (obstacle.y - tip.y) * vy) / (vx * vx + vy * vy),
          ),
        );
        const distance = Math.hypot(obstacle.x - tip.x - t * vx, obstacle.y - tip.y - t * vy);
        if (distance < obstacle.radius + 6) score += 100 + obstacle.radius + 6 - distance;
      }
      for (const rect of rectangles) {
        // Clip the segment against the padded rectangle, including horizontal/vertical arrows.
        let near = 0;
        let far = 1;
        for (const [origin, delta, min, max] of [
          [tip.x, vx, rect.x - 5, rect.x + rect.width + 5],
          [tip.y, vy, rect.y - 5, rect.y + rect.height + 5],
        ]) {
          if (delta === 0) {
            if (origin < min || origin > max) far = -1;
          } else {
            const a = (min - origin) / delta;
            const b = (max - origin) / delta;
            near = Math.max(near, Math.min(a, b));
            far = Math.min(far, Math.max(a, b));
          }
        }
        if (near <= far) score += 100;
      }
      if (!best || score < best.score) best = { start, tip, score };
    }
  return best!;
}
