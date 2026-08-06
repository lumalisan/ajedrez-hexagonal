import type { Direction, Hex } from './types';

export const BOARD_RADIUS = 5;
export const HEX_WIDTH = 60;
export const HEX_HEIGHT = Math.sqrt(3) * 30;

export const ALL_DIRECTIONS = [0, 1, 2, 3, 4, 5] as const;

export const DIRECTION_NAMES: Record<Direction, string> = {
  0: 'N',
  1: 'NE',
  2: 'SE',
  3: 'S',
  4: 'SO',
  5: 'NO',
};

export const DIRECTION_VECTORS: Record<Direction, Hex> = {
  0: { q: 0, r: -1 },
  1: { q: 1, r: -1 },
  2: { q: 1, r: 0 },
  3: { q: 0, r: 1 },
  4: { q: -1, r: 1 },
  5: { q: -1, r: 0 },
};

export function hexKey(hex: Hex): string {
  return `${hex.q},${hex.r}`;
}

export function parseHexKey(key: string): Hex {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

export function addHex(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function scaleHex(hex: Hex, amount: number): Hex {
  return { q: hex.q * amount, r: hex.r * amount };
}

export function stepHex(origin: Hex, direction: Direction, distance = 1): Hex {
  return addHex(origin, scaleHex(DIRECTION_VECTORS[direction], distance));
}

export function equalHex(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

export function isOnBoard(hex: Hex): boolean {
  return Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r)) <= BOARD_RADIUS;
}

export function directionAtOffset(direction: Direction, offset: number): Direction {
  return ((direction + offset + 6) % 6) as Direction;
}

export function frontDirections(direction: Direction): Direction[] {
  return [directionAtOffset(direction, -1), direction, directionAtOffset(direction, 1)];
}

export function directionBetween(from: Hex, to: Hex): Direction | null {
  for (const direction of ALL_DIRECTIONS) {
    for (let distance = 1; distance <= BOARD_RADIUS * 2; distance += 1) {
      if (equalHex(stepHex(from, direction, distance), to)) return direction;
    }
  }
  return null;
}

export function allBoardHexes(): Hex[] {
  const cells: Hex[] = [];
  for (let q = -BOARD_RADIUS; q <= BOARD_RADIUS; q += 1) {
    const rMin = Math.max(-BOARD_RADIUS, -q - BOARD_RADIUS);
    const rMax = Math.min(BOARD_RADIUS, -q + BOARD_RADIUS);
    for (let r = rMin; r <= rMax; r += 1) cells.push({ q, r });
  }
  return cells;
}

export function hexToWorld(hex: Hex): { x: number; y: number } {
  return {
    x: 45 * hex.q,
    y: HEX_HEIGHT * (hex.r + hex.q / 2),
  };
}

export function worldToHex(x: number, y: number): Hex {
  const size = HEX_WIDTH / 2;
  const q = (2 / 3) * (x / size);
  const r = ((-1 / 3) * x + (Math.sqrt(3) / 3) * y) / size;
  return roundAxial(q, r);
}

function roundAxial(q: number, r: number): Hex {
  const x = q;
  const z = r;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);

  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else if (yDiff > zDiff) ry = -rx - rz;
  else rz = -rx - ry;

  return { q: rx, r: rz };
}
