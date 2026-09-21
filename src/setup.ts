import type { Direction, FortressHp, Hex, Piece, PieceType, Player } from './types';

interface SetupPiece {
  type: PieceType;
  position: Hex;
  facing?: Direction;
  cannon?: Direction;
}

export type InitialLayout = 1 | 2 | 3 | 4 | 5;

export const INITIAL_LAYOUTS = [
  {
    id: 1,
    name: 'Frente clásico',
    description:
      'Cinco soldados al frente, dos lanzamisiles en los flancos y dos aviones en retaguardia.',
  },
  {
    id: 2,
    name: 'Columnas de asedio',
    description:
      'Dos capturadores en los flancos y un lanzamisiles en el centro. Conserva los dos aviones.',
  },
  {
    id: 3,
    name: 'Frente blindado',
    description:
      'Cuatro tanques detrás de los cinco soldados. Un lanzamisiles y un avión en retaguardia.',
  },
  {
    id: 4,
    name: 'Frente de infantería',
    description:
      'Siete soldados y dos tanques centrales. Un lanzamisiles y un avión en retaguardia.',
  },
  {
    id: 5,
    name: 'Frente extendido',
    description:
      'Once soldados al frente y dos tanques retrasados. Un lanzamisiles y un avión en retaguardia.',
  },
] as const satisfies ReadonlyArray<{ id: InitialLayout; name: string; description: string }>;

const CLASSIC_BLUE_SETUP: SetupPiece[] = [
  { type: 'soldier', position: { q: 4, r: -4 }, facing: 3 },
  { type: 'soldier', position: { q: 2, r: -3 }, facing: 3 },
  { type: 'soldier', position: { q: 0, r: -2 }, facing: 3 },
  { type: 'soldier', position: { q: -2, r: -1 }, facing: 3 },
  { type: 'soldier', position: { q: -4, r: 0 }, facing: 3 },
  { type: 'long', position: { q: 3, r: -4 } },
  { type: 'long', position: { q: -3, r: -1 } },
  { type: 'medium', position: { q: 1, r: -3 }, cannon: 3 },
  { type: 'medium', position: { q: -1, r: -2 }, cannon: 3 },
  { type: 'fast', position: { q: 4, r: -5 } },
  { type: 'fast', position: { q: -4, r: -1 } },
  { type: 'capturer', position: { q: 0, r: -3 } },
  { type: 'drone', position: { q: 2, r: -5 } },
  { type: 'drone', position: { q: -2, r: -3 } },
  { type: 'fortress', position: { q: 0, r: -4 } },
  { type: 'airplane', position: { q: 1, r: -5 }, facing: 3 },
  { type: 'airplane', position: { q: -1, r: -4 }, facing: 3 },
  { type: 'antiAir', position: { q: 0, r: -5 } },
];

function setupForLayout(initialLayout: InitialLayout): SetupPiece[] {
  if (initialLayout === 1) return CLASSIC_BLUE_SETUP;

  if (initialLayout === 2) {
    return CLASSIC_BLUE_SETUP.map((piece) => {
      if (piece.type === 'long') return { ...piece, type: 'capturer' };
      if (piece.type === 'capturer') return { ...piece, type: 'long' };
      return piece;
    });
  }

  const setup: SetupPiece[] = CLASSIC_BLUE_SETUP.map((piece) => {
    if (piece.type === 'long') {
      return { type: initialLayout === 3 ? 'medium' : 'soldier', position: piece.position };
    }
    if (initialLayout === 5 && piece.type === 'medium') {
      return { type: 'soldier', position: piece.position };
    }
    // Retaguardia izquierda vista desde Cian, cuya cámara gira media vuelta.
    if (piece.type === 'airplane' && piece.position.q === 1) {
      return { type: 'long', position: piece.position };
    }
    return piece;
  });

  if (initialLayout === 5) {
    setup.push(
      { type: 'soldier', position: { q: 5, r: -5 } },
      { type: 'soldier', position: { q: -5, r: 0 } },
      { type: 'medium', position: { q: 2, r: -4 } },
      { type: 'medium', position: { q: -2, r: -2 } },
    );
  }
  return setup;
}

function makePiece(spec: SetupPiece, owner: Player, index: number, fortressHp: FortressHp): Piece {
  const id = `${owner === 0 ? 'azul' : 'ambar'}-${spec.type}-${index + 1}`;
  const position =
    owner === 0
      ? spec.position
      : {
          q: spec.position.q === 0 ? 0 : -spec.position.q,
          r: spec.position.r === 0 ? 0 : -spec.position.r,
        };

  switch (spec.type) {
    case 'soldier':
      return { id, type: 'soldier', owner, position, facing: owner === 0 ? 3 : 0 };
    case 'medium':
      return { id, type: 'medium', owner, position, cannon: owner === 0 ? 3 : 0 };
    case 'airplane':
      return { id, type: 'airplane', owner, position, facing: owner === 0 ? 3 : 0 };
    case 'fortress':
      return { id, type: 'fortress', owner, position, hp: fortressHp };
    case 'capturer':
    case 'long':
    case 'fast':
    case 'drone':
    case 'antiAir':
      return { id, type: spec.type, owner, position };
  }
}

export function createInitialPieces(
  fortressHp: FortressHp = 2,
  initialLayout: InitialLayout = 1,
): Piece[] {
  const setup = setupForLayout(initialLayout);
  return ([0, 1] as const).flatMap((owner) =>
    setup.map((piece, index) => makePiece(piece, owner, index, fortressHp)),
  );
}
