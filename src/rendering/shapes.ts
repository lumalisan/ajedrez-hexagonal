import type { Graphics, StrokeInput } from 'pixi.js';
import { ALL_DIRECTIONS, HEX_WIDTH, allBoardHexes, hexToWorld, isOnBoard, stepHex } from '../hex';

/** Follow exposed cell edges, preserving the board's stepped perimeter and inward corners. */
export function boardOutlinePoints(): number[] {
  type Point = { x: number; y: number };
  const key = ({ x, y }: Point) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;
  const edges = new Map<string, { from: Point; to: Point }>();
  for (const cell of allBoardHexes()) {
    const center = hexToWorld(cell);
    const vertex = (index: number): Point => ({
      x: center.x + Math.cos((index * Math.PI) / 3) * (HEX_WIDTH / 2),
      y: center.y + Math.sin((index * Math.PI) / 3) * (HEX_WIDTH / 2),
    });
    for (let side = 0; side < 6; side++) {
      if (isOnBoard(stepHex(cell, ALL_DIRECTIONS[(side + 2) % 6]))) continue;
      const from = vertex(side);
      edges.set(key(from), { from, to: vertex(side + 1) });
    }
  }
  const points: number[] = [];
  let edge = edges.values().next().value;
  while (edge) {
    points.push(edge.from.x, edge.from.y);
    edges.delete(key(edge.from));
    edge = edges.get(key(edge.to));
  }
  return points;
}

/** Flat-topped hexagon coordinates, in the board's unprojected world space. */
export function hexPoints(radius: number, x = 0, y = 0): number[] {
  const points: number[] = [];
  for (let index = 0; index < 6; index++) {
    const angle = index * (Math.PI / 3);
    points.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  return points;
}

/** Pixi has no Canvas line-dash state; retain the visible segments as one path. */
export function strokeDashedPath(
  graphics: Graphics,
  points: readonly number[],
  dash: number,
  gap: number,
  style: StrokeInput,
  closed = false,
): void {
  if (points.length < 4 || dash <= 0 || gap < 0) return;
  graphics.beginPath();
  const count = points.length / 2;
  const segmentCount = closed ? count : count - 1;
  const period = dash + gap;
  let phase = 0;
  for (let index = 0; index < segmentCount; index++) {
    const next = (index + 1) % count;
    const x = points[index * 2];
    const y = points[index * 2 + 1];
    const dx = points[next * 2] - x;
    const dy = points[next * 2 + 1] - y;
    const length = Math.hypot(dx, dy);
    let offset = 0;
    while (offset < length) {
      const drawn = phase < dash;
      const available = (drawn ? dash : period) - phase;
      const end = Math.min(length, offset + available);
      if (drawn) {
        graphics
          .moveTo(x + (dx * offset) / length, y + (dy * offset) / length)
          .lineTo(x + (dx * end) / length, y + (dy * end) / length);
      }
      phase += end - offset;
      if (phase >= period - 1e-8) phase = 0;
      else if (Math.abs(phase - dash) < 1e-8) phase = dash;
      offset = end;
    }
  }
  graphics.stroke(style);
}
