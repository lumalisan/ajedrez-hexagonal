import { describe, expect, it } from 'vitest';

import {
  applyAction,
  createGameState,
  createInitialState,
  declareBlockade,
  getFiringRangeCells,
  getLegalActionsForPiece,
  getPiece,
  occupancyAt,
  protectedCells,
} from '../src/engine';
import { allBoardHexes, directionAtOffset, hexDistance, isOnBoard, stepHex } from '../src/hex';
import type { Direction, GameAction, GameState, Hex, Piece, Player } from '../src/types';

const hex = (q: number, r: number): Hex => ({ q, r });

function fortress(id: string, owner: Player, position: Hex, hp: 1 | 2 = 2): Piece {
  return { id, type: 'fortress', owner, position, hp };
}

function soldier(id: string, owner: Player, position: Hex, facing: 0 | 1 | 2 | 3 | 4 | 5): Piece {
  return { id, type: 'soldier', owner, position, facing };
}

function base(extra: Piece[], activePlayer: Player = 0): GameState {
  const hasBlueFortress = extra.some((piece) => piece.type === 'fortress' && piece.owner === 0);
  const hasAmberFortress = extra.some((piece) => piece.type === 'fortress' && piece.owner === 1);
  return createGameState(
    [
      ...(hasBlueFortress ? [] : [fortress('fort-blue', 0, hex(-5, 0))]),
      ...(hasAmberFortress ? [] : [fortress('fort-amber', 1, hex(5, 0))]),
      ...extra,
    ],
    activePlayer,
  );
}

function findAction<T extends GameAction['kind']>(
  state: GameState,
  pieceId: string,
  kind: T,
  predicate: (action: Extract<GameAction, { kind: T }>) => boolean = () => true,
): Extract<GameAction, { kind: T }> {
  const action = getLegalActionsForPiece(state, pieceId).find(
    (candidate): candidate is Extract<GameAction, { kind: T }> =>
      candidate.kind === kind && predicate(candidate as Extract<GameAction, { kind: T }>),
  );
  expect(action, `No se encontró acción ${kind} para ${pieceId}`).toBeDefined();
  return action as Extract<GameAction, { kind: T }>;
}

function perform(state: GameState, action: GameAction): GameState {
  const result = applyAction(state, action);
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  return result.state;
}

describe('geometría y despliegue', () => {
  it('genera exactamente 91 hexágonos de radio 5', () => {
    const cells = allBoardHexes();
    expect(cells).toHaveLength(91);
    expect(new Set(cells.map((cell) => `${cell.q},${cell.r}`)).size).toBe(91);
    expect(cells.every(isOnBoard)).toBe(true);
  });

  it('mantiene direcciones y distancia axial', () => {
    expect(stepHex(hex(0, 0), 0)).toEqual(hex(0, -1));
    expect(stepHex(hex(0, 0), 1)).toEqual(hex(1, -1));
    expect(stepHex(hex(0, 0), 5)).toEqual(hex(-1, 0));
    expect(hexDistance(hex(-2, 1), hex(3, -2))).toBe(5);
  });

  it('crea despliegue simétrico con todos los tipos', () => {
    const state = createInitialState();
    expect(state.pieces.filter((piece) => piece.owner === 0)).toHaveLength(18);
    expect(state.pieces.filter((piece) => piece.owner === 1)).toHaveLength(18);
    for (const owner of [0, 1] as const) {
      const pieces = state.pieces.filter((piece) => piece.owner === owner);
      expect(new Set(pieces.map((piece) => piece.type)).size).toBe(9);
      expect(
        pieces.reduce<Record<string, number>>((counts, piece) => {
          counts[piece.type] = (counts[piece.type] ?? 0) + 1;
          return counts;
        }, {}),
      ).toEqual({
        long: 2,
        drone: 2,
        airplane: 2,
        fast: 2,
        fortress: 1,
        medium: 2,
        antiAir: 1,
        soldier: 5,
        capturer: 1,
      });
    }
    expect(
      Object.fromEntries(
        state.pieces
          .filter((piece) => piece.owner === 0)
          .map((piece) => [`${piece.position.q},${piece.position.r}`, piece.type]),
      ),
    ).toEqual({
      '4,-4': 'soldier',
      '2,-3': 'soldier',
      '0,-2': 'soldier',
      '-2,-1': 'soldier',
      '-4,0': 'soldier',
      '3,-4': 'long',
      '-3,-1': 'long',
      '1,-3': 'medium',
      '-1,-2': 'medium',
      '4,-5': 'fast',
      '-4,-1': 'fast',
      '0,-3': 'capturer',
      '2,-5': 'drone',
      '-2,-3': 'drone',
      '0,-4': 'fortress',
      '1,-5': 'airplane',
      '-1,-4': 'airplane',
      '0,-5': 'antiAir',
    });
    for (const blue of state.pieces.filter((piece) => piece.owner === 0)) {
      expect(
        state.pieces.some(
          (amber) =>
            amber.owner === 1 &&
            amber.type === blue.type &&
            amber.position.q === -blue.position.q &&
            amber.position.r === -blue.position.r,
        ),
      ).toBe(true);
    }
    expect(protectedCells(state, 0).size).toBe(4);
    const blueSoldier = state.pieces.find((piece) => piece.owner === 0 && piece.type === 'soldier');
    expect(blueSoldier).toBeDefined();
    expect(getLegalActionsForPiece(state, blueSoldier!.id).length).toBeGreaterThan(0);
  });
});

describe('Soldado y apilamientos terrestres', () => {
  it('solo avanza por arco frontal y actualiza orientación', () => {
    const state = base([soldier('soldier', 0, hex(0, 0), 0)]);
    const moves = getLegalActionsForPiece(state, 'soldier').filter(
      (action) => action.kind === 'move',
    );
    expect(moves.map((action) => action.kind === 'move' && action.to)).toEqual(
      expect.arrayContaining([hex(-1, 0), hex(0, -1), hex(1, -1)]),
    );
    expect(moves).toHaveLength(3);

    const next = perform(
      state,
      findAction(state, 'soldier', 'move', (action) => action.to.q === 1),
    );
    const moved = getPiece(next, 'soldier');
    expect(moved?.type).toBe('soldier');
    if (moved?.type === 'soldier') expect(moved.facing).toBe(1);
  });

  it('rechaza giro hacia orientación actual', () => {
    const state = base([soldier('soldier', 0, hex(0, 0), 0)]);
    const rotations = getLegalActionsForPiece(state, 'soldier').filter(
      (action) => action.kind === 'rotate',
    );
    expect(rotations).toHaveLength(5);
    expect(rotations.some((action) => action.kind === 'rotate' && action.facing === 0)).toBe(false);
  });

  it('destruye suelo de apilamiento rival y queda debajo del Dron', () => {
    const state = base([
      soldier('soldier', 0, hex(0, 0), 0),
      soldier('ground-enemy', 1, hex(0, -1), 3),
      { id: 'air-enemy', type: 'drone', owner: 1, position: hex(0, -1) },
    ]);
    const next = perform(
      state,
      findAction(state, 'soldier', 'move', (action) => action.to.r === -1),
    );
    const occupancy = occupancyAt(next, hex(0, -1));
    expect(occupancy.ground?.id).toBe('soldier');
    expect(occupancy.air?.id).toBe('air-enemy');
    expect(getPiece(next, 'ground-enemy')).toBeUndefined();
  });

  it('permite contraatacar al Dron situado encima sin moverse', () => {
    const state = base([
      soldier('soldier', 0, hex(0, 0), 0),
      { id: 'air-enemy', type: 'drone', owner: 1, position: hex(0, 0) },
    ]);
    const next = perform(state, findAction(state, 'soldier', 'attackAbove'));
    expect(getPiece(next, 'air-enemy')).toBeUndefined();
    expect(getPiece(next, 'soldier')?.position).toEqual(hex(0, 0));
  });

  it('captura un Dron enemigo solitario por ocupación', () => {
    const state = base([
      soldier('soldier', 0, hex(0, 0), 0),
      { id: 'air-enemy', type: 'drone', owner: 1, position: hex(0, -1) },
    ]);
    const next = perform(
      state,
      findAction(state, 'soldier', 'move', (action) => equal(action.to, hex(0, -1))),
    );
    expect(getPiece(next, 'air-enemy')).toBeUndefined();
    expect(getPiece(next, 'soldier')?.position).toEqual(hex(0, -1));
  });
});

describe('Capturador', () => {
  it('convierte sin moverse y conserva orientación', () => {
    const state = base([
      { id: 'capturer', type: 'capturer', owner: 0, position: hex(0, 0) },
      soldier('target', 1, hex(0, -1), 4),
    ]);
    const next = perform(
      state,
      findAction(state, 'capturer', 'convert', (action) => action.targetId === 'target'),
    );
    const target = getPiece(next, 'target');
    expect(target?.owner).toBe(0);
    expect(target?.position).toEqual(hex(0, -1));
    if (target?.type === 'soldier') expect(target.facing).toBe(4);
    expect(getPiece(next, 'capturer')?.position).toEqual(hex(0, 0));
  });

  it('respeta protección mutua entre Capturadores', () => {
    const state = base([
      { id: 'capturer', type: 'capturer', owner: 0, position: hex(0, 0) },
      soldier('target', 1, hex(0, -1), 3),
      { id: 'protector', type: 'capturer', owner: 1, position: hex(1, -1) },
    ]);
    expect(
      getLegalActionsForPiece(state, 'capturer').some(
        (action) => action.kind === 'convert' && action.targetId === 'target',
      ),
    ).toBe(false);
  });

  it('en apilamiento enemigo solo convierte la unidad terrestre', () => {
    const state = base([
      { id: 'capturer', type: 'capturer', owner: 0, position: hex(0, 0) },
      soldier('ground', 1, hex(0, -1), 3),
      { id: 'air', type: 'drone', owner: 1, position: hex(0, -1) },
    ]);
    const actions = getLegalActionsForPiece(state, 'capturer').filter(
      (action) => action.kind === 'convert',
    );
    expect(
      actions.some((action) => action.kind === 'convert' && action.targetId === 'ground'),
    ).toBe(true);
    expect(actions.some((action) => action.kind === 'convert' && action.targetId === 'air')).toBe(
      false,
    );
  });
});

describe('Tanques de disparo', () => {
  it('muestra alcance potencial aunque las casillas estén vacías', () => {
    const mediumState = base([
      { id: 'medium', type: 'medium', owner: 0, position: hex(0, 0), cannon: 0 },
    ]);
    expect(
      getFiringRangeCells(mediumState, 'medium')
        .map(({ q, r }) => `${q},${r}`)
        .sort(),
    ).toEqual(['-1,-1', '0,-2', '1,-2']);

    const longState = base([{ id: 'long', type: 'long', owner: 0, position: hex(0, 0) }]);
    const longRange = getFiringRangeCells(longState, 'long');
    expect(longRange).toHaveLength(18);
    expect(longRange.every((cell) => hexDistance(hex(0, 0), cell) === 3)).toBe(true);
  });

  it('previsualiza alcance desde la futura posición y orientación del cañón', () => {
    const state = base([
      { id: 'medium', type: 'medium', owner: 0, position: hex(0, 0), cannon: 0 },
    ]);
    const preview = getFiringRangeCells(state, 'medium', { position: hex(1, 0), cannon: 2 });
    expect(preview.map(({ q, r }) => `${q},${r}`).sort()).toEqual(['2,1', '3,-1', '3,0']);
  });

  it.each([0, 1, 2, 3, 4, 5] as Direction[])(
    'Tanque medio limita el frente compacto para cañón %s',
    (cannon) => {
      const origin = hex(0, 0);
      const forward = stepHex(origin, cannon);
      const validCells = [-1, 0, 1].map((offset) =>
        stepHex(forward, directionAtOffset(cannon, offset)),
      );
      const invalidCells = [-1, 1].map((offset) =>
        stepHex(origin, directionAtOffset(cannon, offset), 2),
      );
      const state = base([
        { id: 'medium', type: 'medium', owner: 0, position: origin, cannon },
        ...validCells.map((position, index) => soldier(`valid-${index}`, 1, position, 0)),
        ...invalidCells.map((position, index) => soldier(`outside-${index}`, 1, position, 0)),
      ]);
      const targetIds = getLegalActionsForPiece(state, 'medium')
        .filter((action) => action.kind === 'shoot')
        .map((action) => action.targetId)
        .sort();
      expect(targetIds).toEqual(['valid-0', 'valid-1', 'valid-2']);
    },
  );

  it('Tanque medio dispara a distancia 2 atravesando unidades', () => {
    const state = base([
      { id: 'medium', type: 'medium', owner: 0, position: hex(0, 0), cannon: 0 },
      soldier('blocker', 0, hex(0, -1), 0),
      soldier('target', 1, hex(0, -2), 3),
    ]);
    const next = perform(
      state,
      findAction(state, 'medium', 'shoot', (action) => action.targetId === 'target'),
    );
    expect(getPiece(next, 'target')).toBeUndefined();
    expect(getPiece(next, 'blocker')).toBeDefined();
  });

  it('Tanque medio puede mover y orientar cañón en una sola orden', () => {
    const state = base([
      { id: 'medium', type: 'medium', owner: 0, position: hex(0, 0), cannon: 0 },
    ]);
    const action = findAction(
      state,
      'medium',
      'move',
      (candidate) => candidate.to.q === 1 && candidate.to.r === 0 && candidate.cannon === 3,
    );
    const next = perform(state, action);
    const medium = getPiece(next, 'medium');
    expect(medium?.position).toEqual(hex(1, 0));
    if (medium?.type === 'medium') expect(medium.cannon).toBe(3);
  });

  it('Tanque largo ignora bloqueadores ordinarios y exige distancia 3', () => {
    const state = base([
      { id: 'long', type: 'long', owner: 0, position: hex(0, 0) },
      soldier('blocker', 1, hex(0, -1), 3),
      soldier('target', 1, hex(0, -3), 3),
    ]);
    const shots = getLegalActionsForPiece(state, 'long').filter(
      (action) => action.kind === 'shoot',
    );
    expect(shots.some((action) => action.kind === 'shoot' && action.targetId === 'blocker')).toBe(
      false,
    );
    expect(shots.some((action) => action.kind === 'shoot' && action.targetId === 'target')).toBe(
      true,
    );
  });

  it('zona AA bloquea trayectoria de disparo y el Portamisiles nunca es objetivo', () => {
    const state = base([
      { id: 'long', type: 'long', owner: 0, position: hex(0, 0) },
      soldier('target', 1, hex(0, -3), 3),
      { id: 'aa', type: 'antiAir', owner: 1, position: hex(1, -2) },
    ]);
    expect(getLegalActionsForPiece(state, 'long').some((action) => action.kind === 'shoot')).toBe(
      false,
    );

    const mediumState = base([
      { id: 'medium', type: 'medium', owner: 0, position: hex(0, 0), cannon: 0 },
      { id: 'aa-target', type: 'antiAir', owner: 1, position: hex(0, -2) },
    ]);
    expect(
      getLegalActionsForPiece(mediumState, 'medium').some((action) => action.kind === 'shoot'),
    ).toBe(false);
  });

  it('disparo sobre apilamiento ofrece un objetivo por capa', () => {
    const state = base([
      { id: 'medium', type: 'medium', owner: 0, position: hex(0, 0), cannon: 0 },
      soldier('ground', 1, hex(0, -2), 3),
      { id: 'air', type: 'drone', owner: 1, position: hex(0, -2) },
    ]);
    const targets = getLegalActionsForPiece(state, 'medium')
      .filter((action) => action.kind === 'shoot')
      .map((action) => action.kind === 'shoot' && action.targetId);
    expect(targets).toEqual(expect.arrayContaining(['ground', 'air']));
  });
});

describe('Tanque rápido y Dron', () => {
  it('Tanque rápido atraviesa Dron aliado, pero se detiene en primer suelo enemigo', () => {
    const state = base([
      { id: 'fast', type: 'fast', owner: 0, position: hex(0, 0) },
      { id: 'friendly-air', type: 'drone', owner: 0, position: hex(1, 0) },
      soldier('target', 1, hex(3, 0), 3),
      soldier('behind', 1, hex(4, 0), 3),
    ]);
    const moves = getLegalActionsForPiece(state, 'fast').filter((action) => action.kind === 'move');
    expect(moves.some((action) => action.kind === 'move' && action.to.q === 3)).toBe(true);
    expect(moves.some((action) => action.kind === 'move' && equal(action.to, hex(4, 0)))).toBe(
      false,
    );
    const next = perform(
      state,
      findAction(state, 'fast', 'move', (action) => equal(action.to, hex(3, 0))),
    );
    expect(getPiece(next, 'target')).toBeUndefined();
    expect(getPiece(next, 'friendly-air')).toBeDefined();
  });

  it('Dron sobrevuela suelo, pero otro Dron corta la trayectoria', () => {
    const state = base([
      { id: 'drone', type: 'drone', owner: 0, position: hex(0, 0) },
      soldier('ground', 1, hex(1, 0), 3),
      { id: 'blocking-air', type: 'drone', owner: 0, position: hex(2, 0) },
    ]);
    const moves = getLegalActionsForPiece(state, 'drone').filter(
      (action) => action.kind === 'move',
    );
    expect(moves.some((action) => action.kind === 'move' && action.to.q === 1)).toBe(true);
    expect(
      moves.some((action) => action.kind === 'move' && action.to.q >= 2 && action.to.r === 0),
    ).toBe(false);
  });

  it('Dron atacante elimina solo Dron rival y queda sobre suelo enemigo', () => {
    const state = base([
      { id: 'drone', type: 'drone', owner: 0, position: hex(0, 0) },
      soldier('ground', 1, hex(2, 0), 3),
      { id: 'enemy-air', type: 'drone', owner: 1, position: hex(2, 0) },
    ]);
    const next = perform(
      state,
      findAction(state, 'drone', 'move', (action) => equal(action.to, hex(2, 0))),
    );
    const occupancy = occupancyAt(next, hex(2, 0));
    expect(occupancy.air?.id).toBe('drone');
    expect(occupancy.ground?.id).toBe('ground');
    expect(getPiece(next, 'enemy-air')).toBeUndefined();
  });

  it('Dron destruye unidad terrestre solitaria al aterrizar', () => {
    const state = base([
      { id: 'drone', type: 'drone', owner: 0, position: hex(0, 0) },
      soldier('ground', 1, hex(2, 0), 3),
    ]);
    const next = perform(
      state,
      findAction(state, 'drone', 'move', (action) => equal(action.to, hex(2, 0))),
    );
    expect(getPiece(next, 'ground')).toBeUndefined();
    expect(getPiece(next, 'drone')?.position).toEqual(hex(2, 0));
  });

  it('Dron apilado ataca la unidad terrestre enemiga situada debajo', () => {
    const state = base([
      { id: 'drone', type: 'drone', owner: 0, position: hex(0, 0) },
      soldier('ground', 1, hex(0, 0), 3),
    ]);
    const next = perform(state, findAction(state, 'drone', 'attackBelow'));
    expect(getPiece(next, 'ground')).toBeUndefined();
    expect(getPiece(next, 'drone')?.position).toEqual(hex(0, 0));
  });
});

describe('Avión', () => {
  it('distingue la orientación al registrar posiciones para triple repetición', () => {
    const north = base([
      { id: 'airplane', type: 'airplane', owner: 0, position: hex(0, 0), facing: 0 },
    ]);
    const northEast = base([
      { id: 'airplane', type: 'airplane', owner: 0, position: hex(0, 0), facing: 1 },
    ]);
    expect(Object.keys(north.positionCounts)).not.toEqual(Object.keys(northEast.positionCounts));
  });

  it('vuela hasta dos casillas por el frente, sobrevuela suelo y gira al desplazarse en diagonal', () => {
    const state = base([
      { id: 'airplane', type: 'airplane', owner: 0, position: hex(0, 0), facing: 0 },
      soldier('ground', 0, hex(1, -1), 0),
    ]);
    const next = perform(
      state,
      findAction(state, 'airplane', 'move', (action) => equal(action.to, hex(2, -2))),
    );
    const airplane = getPiece(next, 'airplane');
    expect(airplane?.position).toEqual(hex(2, -2));
    if (airplane?.type === 'airplane') expect(airplane.facing).toBe(1);
  });

  it('dispara a las ocho casillas del cono frontal y comparte la central con el movimiento', () => {
    const state = base([
      { id: 'airplane', type: 'airplane', owner: 0, position: hex(0, 0), facing: 0 },
    ]);
    const range = getFiringRangeCells(state, 'airplane');
    expect(range.map(({ q, r }) => `${q},${r}`).sort()).toEqual([
      '-1,-1',
      '-1,-2',
      '-2,-1',
      '0,-2',
      '0,-3',
      '1,-2',
      '1,-3',
      '2,-3',
    ]);
    const moves = getLegalActionsForPiece(state, 'airplane').filter(
      (action) => action.kind === 'move',
    );
    expect(moves.some((action) => action.kind === 'move' && equal(action.to, hex(0, -2)))).toBe(
      true,
    );
  });

  it('realiza un kamikaze contra suelo o aire y destruye ambas unidades', () => {
    const state = base([
      { id: 'airplane', type: 'airplane', owner: 0, position: hex(0, 0), facing: 0 },
      { id: 'enemy-air', type: 'drone', owner: 1, position: hex(0, -2) },
    ]);
    const next = perform(
      state,
      findAction(state, 'airplane', 'move', (action) => equal(action.to, hex(0, -2))),
    );
    expect(getPiece(next, 'airplane')).toBeUndefined();
    expect(getPiece(next, 'enemy-air')).toBeUndefined();
  });

  it('es pulverizado al entrar en un escudo antes de completar un kamikaze', () => {
    const state = base([
      { id: 'airplane', type: 'airplane', owner: 0, position: hex(0, 0), facing: 1 },
      { id: 'aa', type: 'antiAir', owner: 1, position: hex(2, -1) },
      soldier('target', 1, hex(1, -1), 3),
    ]);
    const result = applyAction(
      state,
      findAction(state, 'airplane', 'move', (action) => equal(action.to, hex(1, -1))),
    );
    expect(getPiece(result.state, 'airplane')).toBeUndefined();
    expect(getPiece(result.state, 'target')).toBeDefined();
    expect(result.events.some((event) => event.type === 'intercept')).toBe(true);
  });

  it('bloquea el paso y el aterrizaje de los Drones', () => {
    const state = base([
      { id: 'drone', type: 'drone', owner: 0, position: hex(0, 0) },
      { id: 'airplane', type: 'airplane', owner: 1, position: hex(1, 0), facing: 3 },
    ]);
    const moves = getLegalActionsForPiece(state, 'drone').filter(
      (action) => action.kind === 'move',
    );
    expect(
      moves.some((action) => action.kind === 'move' && action.to.r === 0 && action.to.q > 0),
    ).toBe(false);
  });
});

describe('Escudo antiaéreo', () => {
  it('intercepta Dron en primera casilla protegida', () => {
    const state = base([
      { id: 'drone', type: 'drone', owner: 0, position: hex(0, 0) },
      { id: 'aa', type: 'antiAir', owner: 1, position: hex(2, 0) },
    ]);
    const moves = getLegalActionsForPiece(state, 'drone').filter(
      (action) => action.kind === 'move',
    );
    expect(moves.some((action) => action.kind === 'move' && equal(action.to, hex(1, 0)))).toBe(
      true,
    );
    expect(moves.some((action) => action.kind === 'move' && equal(action.to, hex(2, 0)))).toBe(
      false,
    );
    const result = applyAction(
      state,
      findAction(state, 'drone', 'move', (action) => equal(action.to, hex(1, 0))),
    );
    expect(result.ok).toBe(true);
    expect(getPiece(result.state, 'drone')).toBeUndefined();
    expect(result.events.some((event) => event.type === 'intercept')).toBe(true);
  });

  it('permanece inmóvil y no genera acciones propias', () => {
    const state = base([{ id: 'aa', type: 'antiAir', owner: 0, position: hex(0, 0) }]);
    expect(getLegalActionsForPiece(state, 'aa')).toEqual([]);
  });

  it('solo Soldado y Tanque rápido lo destruyen por ocupación; Capturador lo convierte', () => {
    const soldierState = base([
      soldier('soldier', 0, hex(0, 0), 0),
      { id: 'aa', type: 'antiAir', owner: 1, position: hex(0, -1) },
    ]);
    const afterSoldier = perform(
      soldierState,
      findAction(soldierState, 'soldier', 'move', (action) => action.to.r === -1),
    );
    expect(getPiece(afterSoldier, 'aa')).toBeUndefined();

    const captureState = base([
      { id: 'capturer', type: 'capturer', owner: 0, position: hex(0, 0) },
      { id: 'aa', type: 'antiAir', owner: 1, position: hex(0, -1) },
    ]);
    const afterCapture = perform(captureState, findAction(captureState, 'capturer', 'convert'));
    expect(getPiece(afterCapture, 'aa')?.owner).toBe(0);

    const fastState = base([
      { id: 'fast', type: 'fast', owner: 0, position: hex(0, 0) },
      { id: 'aa', type: 'antiAir', owner: 1, position: hex(3, 0) },
    ]);
    const afterFast = perform(
      fastState,
      findAction(fastState, 'fast', 'move', (action) => equal(action.to, hex(3, 0))),
    );
    expect(getPiece(afterFast, 'aa')).toBeUndefined();
    expect(getPiece(afterFast, 'fast')?.position).toEqual(hex(3, 0));
  });
});

describe('Fortaleza, transformación y finales', () => {
  it('Soldado causa 1 HP a Fortaleza y se sacrifica', () => {
    const state = base([
      fortress('fort-amber-close', 1, hex(0, -1)),
      soldier('soldier', 0, hex(0, 0), 0),
      soldier('amber-mobile', 1, hex(2, 0), 3),
    ]);
    const next = perform(
      state,
      findAction(state, 'soldier', 'move', (action) => action.to.r === -1),
    );
    const target = getPiece(next, 'fort-amber-close');
    expect(target?.type).toBe('fortress');
    if (target?.type === 'fortress') expect(target.hp).toBe(1);
    expect(getPiece(next, 'soldier')).toBeUndefined();
    expect(next.firstFortressDamageBy).toBe(0);
    expect(next.outcome).toBeNull();
  });

  it('pieza pesada destruye Fortaleza de un golpe y gana', () => {
    const state = base([
      fortress('fort-amber-close', 1, hex(1, 0)),
      { id: 'fast', type: 'fast', owner: 0, position: hex(0, 0) },
    ]);
    const next = perform(
      state,
      findAction(state, 'fast', 'move', (action) => equal(action.to, hex(1, 0))),
    );
    expect(getPiece(next, 'fort-amber-close')).toBeUndefined();
    expect(next.outcome).toEqual({ type: 'win', winner: 0, reason: 'fortress' });
    expect(getPiece(next, 'fast')?.position).toEqual(hex(1, 0));
  });

  it('Capturador sabotea Fortaleza, causa 1 HP y se sacrifica', () => {
    const state = base([
      fortress('fort-amber-close', 1, hex(0, -1)),
      { id: 'capturer', type: 'capturer', owner: 0, position: hex(0, 0) },
      soldier('amber-mobile', 1, hex(2, 0), 3),
    ]);
    const next = perform(
      state,
      findAction(state, 'capturer', 'convert', (action) => action.targetId === 'fort-amber-close'),
    );
    const target = getPiece(next, 'fort-amber-close');
    if (target?.type === 'fortress') expect(target.hp).toBe(1);
    else throw new Error('Fortaleza parcial ausente');
    expect(getPiece(next, 'capturer')).toBeUndefined();
    expect(next.firstFortressDamageBy).toBe(0);
  });

  it.each([
    {
      label: 'Tanque medio',
      piece: { id: 'attacker', type: 'medium', owner: 0, position: hex(0, 0), cannon: 0 } as Piece,
      target: hex(0, -2),
      kind: 'shoot' as const,
    },
    {
      label: 'Tanque largo',
      piece: { id: 'attacker', type: 'long', owner: 0, position: hex(0, 0) } as Piece,
      target: hex(0, -3),
      kind: 'shoot' as const,
    },
    {
      label: 'Dron',
      piece: { id: 'attacker', type: 'drone', owner: 0, position: hex(0, 0) } as Piece,
      target: hex(2, 0),
      kind: 'move' as const,
    },
  ])('$label destruye Fortaleza con un ataque y sobrevive', ({ piece, target, kind }) => {
    const state = base([fortress('fort-amber-close', 1, target), piece]);
    const action =
      kind === 'shoot'
        ? findAction(
            state,
            'attacker',
            'shoot',
            (candidate) => candidate.targetId === 'fort-amber-close',
          )
        : findAction(state, 'attacker', 'move', (candidate) => equal(candidate.to, target));
    const next = perform(state, action);
    expect(getPiece(next, 'fort-amber-close')).toBeUndefined();
    expect(getPiece(next, 'attacker')).toBeDefined();
    expect(next.outcome).toEqual({ type: 'win', winner: 0, reason: 'fortress' });
  });

  it('segundo sacrificio destruye Fortaleza ya dañada', () => {
    const state = base([
      fortress('fort-amber-close', 1, hex(0, -1), 1),
      soldier('soldier', 0, hex(0, 0), 0),
    ]);
    state.firstFortressDamageBy = 0;
    const next = perform(
      state,
      findAction(state, 'soldier', 'move', (action) => equal(action.to, hex(0, -1))),
    );
    expect(getPiece(next, 'fort-amber-close')).toBeUndefined();
    expect(getPiece(next, 'soldier')).toBeUndefined();
    expect(next.outcome).toEqual({ type: 'win', winner: 0, reason: 'fortress' });
  });

  it('tanque se transforma y mueve como Soldado en el mismo turno', () => {
    const state = base([
      { id: 'medium', type: 'medium', owner: 0, position: hex(0, 0), cannon: 3 },
    ]);
    const action = findAction(
      state,
      'medium',
      'transform',
      (candidate) =>
        candidate.facing === 0 && Boolean(candidate.to && equal(candidate.to, hex(0, -1))),
    );
    const next = perform(state, action);
    const transformed = getPiece(next, 'medium');
    expect(transformed?.type).toBe('soldier');
    expect(transformed?.position).toEqual(hex(0, -1));
    if (transformed?.type === 'soldier') expect(transformed.facing).toBe(0);
  });

  it('tanque transformado puede contraatacar al Dron superior', () => {
    const state = base([
      { id: 'fast', type: 'fast', owner: 0, position: hex(0, 0) },
      { id: 'air', type: 'drone', owner: 1, position: hex(0, 0) },
    ]);
    const action = findAction(
      state,
      'fast',
      'transform',
      (candidate) => candidate.facing === 0 && candidate.attackAboveId === 'air',
    );
    const next = perform(state, action);
    expect(getPiece(next, 'air')).toBeUndefined();
    expect(getPiece(next, 'fast')?.type).toBe('soldier');
  });

  it('tercera repetición declara tablas con Fortalezas intactas', () => {
    let state = base([
      soldier('blue-soldier', 0, hex(0, -2), 0),
      soldier('amber-soldier', 1, hex(0, 2), 3),
    ]);
    for (let cycle = 0; cycle < 2; cycle += 1) {
      state = perform(
        state,
        findAction(state, 'blue-soldier', 'rotate', (action) => action.facing === 1),
      );
      state = perform(
        state,
        findAction(state, 'amber-soldier', 'rotate', (action) => action.facing === 4),
      );
      state = perform(
        state,
        findAction(state, 'blue-soldier', 'rotate', (action) => action.facing === 0),
      );
      state = perform(
        state,
        findAction(state, 'amber-soldier', 'rotate', (action) => action.facing === 3),
      );
    }
    expect(state.outcome).toEqual({ type: 'draw', reason: 'repetition' });
  });

  it('bloqueo acordado concede victoria a quien infligió primer daño', () => {
    const state = base([], 0);
    state.firstFortressDamageBy = 1;
    const blueFortress = state.pieces.find(
      (piece) => piece.type === 'fortress' && piece.owner === 0,
    );
    if (blueFortress?.type === 'fortress') blueFortress.hp = 1;
    const result = declareBlockade(state);
    expect(result.state.outcome).toEqual({ type: 'win', winner: 1, reason: 'blockade' });
  });
});

function equal(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}
