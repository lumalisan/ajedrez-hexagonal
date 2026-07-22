import type { Direction, Hex, Piece, PieceType, Player } from './types';

interface SetupPiece {
  type: PieceType;
  position: Hex;
  facing?: Direction;
  cannon?: Direction;
}

const BLUE_SETUP: SetupPiece[] = [
  { type: 'fortress', position: { q: 0, r: -5 } },
  { type: 'antiAir', position: { q: 1, r: -5 } },
  { type: 'drone', position: { q: -1, r: -4 } },
  { type: 'drone', position: { q: 2, r: -4 } },
  { type: 'long', position: { q: -2, r: -3 } },
  { type: 'fast', position: { q: 0, r: -4 } },
  { type: 'medium', position: { q: 2, r: -5 }, cannon: 3 },
  { type: 'capturer', position: { q: -2, r: -2 } },
  { type: 'soldier', position: { q: -3, r: -2 }, facing: 3 },
  { type: 'soldier', position: { q: -1, r: -3 }, facing: 3 },
  { type: 'soldier', position: { q: 1, r: -4 }, facing: 3 },
  { type: 'soldier', position: { q: 3, r: -5 }, facing: 3 },
  { type: 'soldier', position: { q: 0, r: -3 }, facing: 3 },
];

function makePiece(spec: SetupPiece, owner: Player, index: number): Piece {
  const id = `${owner === 0 ? 'azul' : 'ambar'}-${spec.type}-${index + 1}`;
  const position = owner === 0 ? spec.position : { q: -spec.position.q, r: -spec.position.r };

  switch (spec.type) {
    case 'soldier':
      return { id, type: 'soldier', owner, position, facing: owner === 0 ? 3 : 0 };
    case 'medium':
      return { id, type: 'medium', owner, position, cannon: owner === 0 ? 3 : 0 };
    case 'fortress':
      return { id, type: 'fortress', owner, position, hp: 2 };
    case 'capturer':
    case 'long':
    case 'fast':
    case 'drone':
    case 'antiAir':
      return { id, type: spec.type, owner, position };
  }
}

export function createInitialPieces(): Piece[] {
  return ([0, 1] as const).flatMap((owner) =>
    BLUE_SETUP.map((piece, index) => makePiece(piece, owner, index)),
  );
}
