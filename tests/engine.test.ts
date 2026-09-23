import { describe, expect, it } from 'vitest';

import {
  applyAction,
  createGameState,
  createInitialState,
  declareBlockade,
  describeAction,
  firstAirInterception,
  getAllLegalActions,
  getFiringRangeCells,
  getLegalActionsForPiece,
  getPiece,
  occupancyAt,
  protectedCells,
} from '../src/engine';
import { allBoardHexes, directionAtOffset, hexDistance, isOnBoard, stepHex } from '../src/hex';
import { markerKind } from '../src/rendering/model';
import { SCENARIOS } from '../src/scenarios';
import type {
  Direction,
  FortressHp,
  GameAction,
  GameState,
  Hex,
  Piece,
  Player,
} from '../src/types';

const hex = (q: number, r: number): Hex => ({ q, r });

function fortress(id: string, owner: Player, position: Hex, hp: FortressHp = 2): Piece {
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

function freezeRecursively<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeRecursively(child);
    Object.freeze(value);
  }
  return value;
}

describe('inmutabilidad de la resolución', () => {
  it('resuelve todas las clases de acción con estados y órdenes congelados', () => {
    const positions = [
      { id: 'initial', state: createInitialState() },
      {
        id: 'attack-above',
        state: base([
          soldier('ground', 0, hex(0, 0), 0),
          { id: 'air', type: 'drone', owner: 1, position: hex(0, 0) },
        ]),
      },
      {
        id: 'attack-below',
        state: base([
          { id: 'air', type: 'drone', owner: 0, position: hex(0, 0) },
          soldier('ground', 1, hex(0, 0), 0),
        ]),
      },
      ...SCENARIOS.map((scenario) => ({
        id: scenario.id,
        state: structuredClone(scenario.initialState),
      })),
    ];
    const resolvedKinds = new Set<GameAction['kind']>();
    for (const { id, state } of positions) {
      freezeRecursively(state);
      for (const action of getAllLegalActions(state)) {
        freezeRecursively(action);
        const result = applyAction(state, action);
        expect(result.ok, `${id}: ${action.kind}`).toBe(true);
        expect(result.state).not.toBe(state);
        resolvedKinds.add(action.kind);
      }
    }
    expect(resolvedKinds).toEqual(
      new Set([
        'move',
        'rotate',
        'orient',
        'shoot',
        'convert',
        'attackAbove',
        'attackBelow',
        'transform',
      ]),
    );
  });
});

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

  it('puede elegir entre avanzar bajo un Avión enemigo o atacarlo', () => {
    const state = base([
      soldier('soldier', 0, hex(0, 0), 0),
      { id: 'enemy-airplane', type: 'airplane', owner: 1, position: hex(0, -1), facing: 3 },
    ]);
    const actions = getLegalActionsForPiece(state, 'soldier').filter(
      (candidate) => candidate.kind === 'move' && equal(candidate.to, hex(0, -1)),
    );
    expect(actions).toHaveLength(2);
    const quietMove = actions.find((action) => action.kind === 'move' && !action.targetId);
    const attack = actions.find((action) => action.kind === 'move' && action.targetId);
    expect(quietMove && describeAction(state, quietMove)).toContain('se moverá');
    expect(quietMove && markerKind(state, quietMove)).toBe('move');
    expect(attack && describeAction(state, attack)).toContain('atacará Avión');
    expect(attack && markerKind(state, attack)).toBe('capture');

    const moved = perform(state, quietMove!);
    const occupancy = occupancyAt(moved, hex(0, -1));
    expect(occupancy.ground?.id).toBe('soldier');
    expect(occupancy.air?.id).toBe('enemy-airplane');
    expect(
      getLegalActionsForPiece({ ...moved, activePlayer: 0 }, 'soldier').some(
        (action) => action.kind === 'attackAbove',
      ),
    ).toBe(true);

    const attacked = perform(state, attack!);
    expect(getPiece(attacked, 'enemy-airplane')).toBeUndefined();
    expect(getPiece(attacked, 'soldier')?.position).toEqual(hex(0, -1));
  });
});

describe('Paso terrestre bajo aeronaves', () => {
  it.each([
    {
      label: 'Capturador',
      piece: { id: 'ground', type: 'capturer', owner: 0, position: hex(0, 0) } as Piece,
    },
    {
      label: 'Tanque',
      piece: { id: 'ground', type: 'medium', owner: 0, position: hex(0, 0), cannon: 0 } as Piece,
    },
    {
      label: 'Lanzamisiles',
      piece: { id: 'ground', type: 'long', owner: 0, position: hex(0, 0) } as Piece,
    },
  ])('$label puede situarse bajo un Avión enemigo, pero no bajo un Dron', ({ piece }) => {
    const airplaneState = base([
      piece,
      { id: 'airplane', type: 'airplane', owner: 1, position: hex(1, 0), facing: 3 },
    ]);
    expect(
      getLegalActionsForPiece(airplaneState, 'ground').some(
        (action) => action.kind === 'move' && equal(action.to, hex(1, 0)),
      ),
    ).toBe(true);

    const droneState = base([piece, { id: 'drone', type: 'drone', owner: 1, position: hex(1, 0) }]);
    expect(
      getLegalActionsForPiece(droneState, 'ground').some(
        (action) => action.kind === 'move' && equal(action.to, hex(1, 0)),
      ),
    ).toBe(false);
  });

  it.each([{ type: 'drone' as const }, { type: 'airplane' as const, facing: 3 as Direction }])(
    'marca como movimiento el paso terrestre bajo $type aliado',
    (air) => {
      const state = base([
        { id: 'ground', type: 'capturer', owner: 0, position: hex(0, 0) },
        { id: 'air', owner: 0, position: hex(1, 0), ...air } as Piece,
      ]);
      const action = findAction(state, 'ground', 'move', (candidate) =>
        equal(candidate.to, hex(1, 0)),
      );
      expect(markerKind(state, action)).toBe('move');
    },
  );

  it('el Embestidor atraviesa un Avión enemigo sin dañarlo', () => {
    const state = base([
      { id: 'fast', type: 'fast', owner: 0, position: hex(0, 0) },
      { id: 'airplane', type: 'airplane', owner: 1, position: hex(1, 0), facing: 3 },
    ]);
    const next = perform(
      state,
      findAction(state, 'fast', 'move', (action) => equal(action.to, hex(2, 0))),
    );
    expect(getPiece(next, 'airplane')?.position).toEqual(hex(1, 0));
    expect(getPiece(next, 'fast')?.position).toEqual(hex(2, 0));

    const attack = findAction(
      state,
      'fast',
      'move',
      (action) => equal(action.to, hex(1, 0)) && action.targetId === 'airplane',
    );
    const attacked = perform(state, attack);
    expect(getPiece(attacked, 'airplane')).toBeUndefined();
    expect(getPiece(attacked, 'fast')?.position).toEqual(hex(1, 0));
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

  it('puede convertir un Dron o un Avión enemigo situado encima', () => {
    const droneState = base([
      { id: 'capturer', type: 'capturer', owner: 0, position: hex(0, 0) },
      { id: 'air', type: 'drone', owner: 1, position: hex(0, 0) },
    ]);
    expect(
      getLegalActionsForPiece(droneState, 'capturer').some(
        (action) => action.kind === 'convert' && action.targetId === 'air',
      ),
    ).toBe(true);

    const airplaneState = base([
      { id: 'capturer', type: 'capturer', owner: 0, position: hex(0, 0) },
      { id: 'air', type: 'airplane', owner: 1, position: hex(0, 0), facing: 3 },
    ]);
    expect(
      getLegalActionsForPiece(airplaneState, 'capturer').some(
        (action) => action.kind === 'convert' && action.targetId === 'air',
      ),
    ).toBe(true);
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
    'Tanque limita el frente compacto para cañón %s',
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

  it('Tanque dispara a distancia 2 atravesando unidades', () => {
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

  it('Tanque puede mover y orientar cañón en una sola orden', () => {
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

  it('Lanzamisiles ignora bloqueadores ordinarios y exige distancia 3', () => {
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

describe('Embestidor y Dron', () => {
  it('Embestidor atraviesa Dron aliado, pero se detiene en primer suelo enemigo', () => {
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

  it('puede atacar un Dron o un Avión enemigo situado encima', () => {
    const droneState = base([
      { id: 'fast', type: 'fast', owner: 0, position: hex(0, 0) },
      { id: 'air', type: 'drone', owner: 1, position: hex(0, 0) },
    ]);
    expect(
      getLegalActionsForPiece(droneState, 'fast').some(
        (action) => action.kind === 'attackAbove' && action.targetId === 'air',
      ),
    ).toBe(true);

    const airplaneState = base([
      { id: 'fast', type: 'fast', owner: 0, position: hex(0, 0) },
      { id: 'air', type: 'airplane', owner: 1, position: hex(0, 0), facing: 3 },
    ]);
    expect(
      getLegalActionsForPiece(airplaneState, 'fast').some(
        (action) => action.kind === 'attackAbove' && action.targetId === 'air',
      ),
    ).toBe(true);
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

  it('Dron captura un Avión rival y no puede atravesarlo', () => {
    const state = base([
      { id: 'drone', type: 'drone', owner: 0, position: hex(0, 0) },
      { id: 'airplane', type: 'airplane', owner: 1, position: hex(2, 0), facing: 3 },
    ]);
    const moves = getLegalActionsForPiece(state, 'drone').filter(
      (action) => action.kind === 'move',
    );
    expect(moves.some((action) => action.kind === 'move' && equal(action.to, hex(2, 0)))).toBe(
      true,
    );
    expect(moves.some((action) => action.kind === 'move' && equal(action.to, hex(3, 0)))).toBe(
      false,
    );

    const next = perform(
      state,
      findAction(state, 'drone', 'move', (action) => equal(action.to, hex(2, 0))),
    );
    expect(getPiece(next, 'airplane')).toBeUndefined();
    expect(getPiece(next, 'drone')?.position).toEqual(hex(2, 0));
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
      findAction(
        state,
        'airplane',
        'move',
        (action) => Boolean(action.kamikaze) && equal(action.to, hex(0, -2)),
      ),
    );
    expect(getPiece(next, 'airplane')).toBeUndefined();
    expect(getPiece(next, 'enemy-air')).toBeUndefined();
  });

  it('elige una sola capa al hacer kamikaze contra una casilla compartida', () => {
    const state = base([
      { id: 'airplane', type: 'airplane', owner: 0, position: hex(0, 0), facing: 0 },
      soldier('enemy-ground', 1, hex(0, -2), 3),
      { id: 'enemy-air', type: 'drone', owner: 1, position: hex(0, -2) },
    ]);
    const kamikazes = getLegalActionsForPiece(state, 'airplane').filter(
      (action) => action.kind === 'move' && action.kamikaze && equal(action.to, hex(0, -2)),
    );

    expect(kamikazes).toHaveLength(2);
    expect(kamikazes.map((action) => action.kind === 'move' && action.targetId)).toEqual(
      expect.arrayContaining(['enemy-ground', 'enemy-air']),
    );

    const againstGround = perform(
      state,
      findAction(
        state,
        'airplane',
        'move',
        (action) => action.kamikaze === true && action.targetId === 'enemy-ground',
      ),
    );
    expect(getPiece(againstGround, 'airplane')).toBeUndefined();
    expect(getPiece(againstGround, 'enemy-ground')).toBeUndefined();
    expect(getPiece(againstGround, 'enemy-air')).toBeDefined();

    const againstAir = perform(
      state,
      findAction(
        state,
        'airplane',
        'move',
        (action) => action.kamikaze === true && action.targetId === 'enemy-air',
      ),
    );
    expect(getPiece(againstAir, 'airplane')).toBeUndefined();
    expect(getPiece(againstAir, 'enemy-air')).toBeUndefined();
    expect(getPiece(againstAir, 'enemy-ground')).toBeDefined();

    const legacyImplicitAirTarget = perform(state, {
      kind: 'move',
      pieceId: 'airplane',
      to: hex(0, -2),
      kamikaze: true,
    });
    expect(getPiece(legacyImplicitAirTarget, 'airplane')).toBeUndefined();
    expect(getPiece(legacyImplicitAirTarget, 'enemy-air')).toBeUndefined();
    expect(getPiece(legacyImplicitAirTarget, 'enemy-ground')).toBeDefined();
  });

  it('permite elegir entre sobrevuelo, kamikaze y disparo en la casilla mixta ocupada', () => {
    const pieces: Piece[] = [
      { id: 'airplane', type: 'airplane', owner: 0, position: hex(0, 0), facing: 0 },
      soldier('target', 1, hex(0, -2), 3),
    ];
    const state = base(pieces);
    const actions = getLegalActionsForPiece(state, 'airplane');
    const moves = actions.filter(
      (action) => action.kind === 'move' && equal(action.to, hex(0, -2)),
    );
    expect(moves).toHaveLength(2);
    expect(moves.some((action) => action.kind === 'move' && !action.kamikaze)).toBe(true);
    expect(moves.some((action) => action.kind === 'move' && action.kamikaze)).toBe(true);
    expect(actions.some((action) => action.kind === 'shoot' && action.targetId === 'target')).toBe(
      true,
    );

    const overflight = perform(
      state,
      findAction(
        state,
        'airplane',
        'move',
        (action) => !action.kamikaze && equal(action.to, hex(0, -2)),
      ),
    );
    expect(getPiece(overflight, 'airplane')?.position).toEqual(hex(0, -2));
    expect(getPiece(overflight, 'target')).toBeDefined();

    const kamikazeState = base(pieces);
    const kamikaze = perform(
      kamikazeState,
      findAction(
        kamikazeState,
        'airplane',
        'move',
        (action) => Boolean(action.kamikaze) && equal(action.to, hex(0, -2)),
      ),
    );
    expect(getPiece(kamikaze, 'airplane')).toBeUndefined();
    expect(getPiece(kamikaze, 'target')).toBeUndefined();
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

  it('un Avión aliado bloquea el paso y el aterrizaje de los Drones', () => {
    const state = base([
      { id: 'drone', type: 'drone', owner: 0, position: hex(0, 0) },
      { id: 'airplane', type: 'airplane', owner: 0, position: hex(1, 0), facing: 3 },
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
  it.each([false, true])(
    'admite una orden de Dron al escudo y lo intercepta antes (casilla intermedia ocupada: %s)',
    (occupied) => {
      const state = base([
        { id: 'drone', type: 'drone', owner: 0, position: hex(0, 0) },
        { id: 'aa', type: 'antiAir', owner: 1, position: hex(2, 0) },
        ...(occupied ? [soldier('ground', 1, hex(1, 0), 3)] : []),
      ]);
      const before = structuredClone(state);
      freezeRecursively(state);
      const moves = getLegalActionsForPiece(state, 'drone').filter(
        (action) => action.kind === 'move',
      );
      expect(moves.map((action) => action.to)).toEqual(
        expect.arrayContaining([hex(1, 0), hex(2, 0), hex(3, 0)]),
      );
      const action = findAction(state, 'drone', 'move', (candidate) =>
        equal(candidate.to, hex(2, 0)),
      );
      freezeRecursively(action);
      expect(describeAction(state, action)).toBe(
        'Dron se moverá hacia [+2, +0] y será interceptado en [+1, +0]',
      );
      const result = applyAction(state, action);
      expect(result.ok).toBe(true);
      expect(result.state.pieces).toEqual(before.pieces.filter((piece) => piece.id !== 'drone'));
      expect(result.events.filter((event) => event.type === 'move')).toEqual([
        { type: 'move', pieceId: 'drone', owner: 0, from: hex(0, 0), to: hex(1, 0) },
      ]);
      expect(result.events.filter((event) => event.type === 'intercept')).toEqual([
        { type: 'intercept', pieceId: 'drone', targetId: 'drone', owner: 1, at: hex(1, 0) },
      ]);
      expect(
        result.events.some((event) => event.type === 'destroy' || event.type === 'fortressDamage'),
      ).toBe(false);
      expect(state).toEqual(before);
      expect(action.to).toEqual(hex(2, 0));
      expect(result.state.history.find((entry) => entry.id === result.state.ply)?.text).toBe(
        'Dron fue interceptado en [+1, +0].',
      );
    },
  );

  it.each(['drone', 'airplane'] as const)(
    'conserva el bloqueo de un %s en una casilla protegida',
    (type) => {
      const state = base([
        { id: 'drone', type: 'drone', owner: 0, position: hex(0, 0) },
        { id: 'aa', type: 'antiAir', owner: 1, position: hex(2, 0) },
        type === 'drone'
          ? { id: 'blocking-air', type, owner: 1, position: hex(1, 0) }
          : { id: 'blocking-air', type, owner: 1, position: hex(1, 0), facing: 3 },
      ]);
      const moves = getLegalActionsForPiece(state, 'drone').filter(
        (action) => action.kind === 'move' && action.to.r === 0 && action.to.q > 0,
      );
      expect(moves).toEqual([{ kind: 'move', pieceId: 'drone', to: hex(1, 0) }]);
      expect(describeAction(state, moves[0])).toBe('Dron será interceptado en [+1, +0]');
      const result = applyAction(state, moves[0]);
      expect(result.ok).toBe(true);
      expect(result.state.pieces).toEqual(state.pieces.filter((piece) => piece.id !== 'drone'));
    },
  );

  it('detecta la intercepción en la ruta aunque el destino esté fuera del escudo', () => {
    const state = base([
      { id: 'drone', type: 'drone', owner: 0, position: hex(0, 0) },
      { id: 'aa', type: 'antiAir', owner: 1, position: hex(1, 1) },
    ]);
    const piece = getPiece(state, 'drone')!;
    const action = findAction(state, 'drone', 'move', (candidate) =>
      equal(candidate.to, hex(3, 0)),
    );
    expect(protectedCells(state, 1).has('3,0')).toBe(false);
    expect(firstAirInterception(state, piece, action.to)).toEqual(hex(1, 0));
    expect(describeAction(state, action)).toBe(
      'Dron se moverá hacia [+3, +0] y será interceptado en [+1, +0]',
    );
    const result = applyAction(state, action);
    expect(result.ok).toBe(true);
    expect(getPiece(result.state, 'drone')).toBeUndefined();
    expect(result.events.find((event) => event.type === 'intercept')?.at).toEqual(hex(1, 0));
    expect(result.state.history.find((entry) => entry.id === result.state.ply)?.text).toBe(
      'Dron fue interceptado en [+1, +0].',
    );
    const safe = findAction(state, 'drone', 'move', (candidate) => equal(candidate.to, hex(3, -3)));
    expect(firstAirInterception(state, piece, safe.to)).toBeNull();
  });

  it('permanece inmóvil y no genera acciones propias', () => {
    const state = base([{ id: 'aa', type: 'antiAir', owner: 0, position: hex(0, 0) }]);
    expect(getLegalActionsForPiece(state, 'aa')).toEqual([]);
  });

  it('solo Soldado y Embestidor lo destruyen por ocupación; Capturador lo convierte', () => {
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

  it('Embestidor causa 1 HP a la Fortaleza y se sacrifica', () => {
    const state = base([
      fortress('fort-amber-close', 1, hex(1, 0)),
      { id: 'fast', type: 'fast', owner: 0, position: hex(0, 0) },
      soldier('amber-mobile', 1, hex(3, 0), 3),
    ]);
    const next = perform(
      state,
      findAction(state, 'fast', 'move', (action) => equal(action.to, hex(1, 0))),
    );
    expect(getPiece(next, 'fort-amber-close')).toMatchObject({ type: 'fortress', hp: 1 });
    expect(next.outcome).toBeNull();
    expect(getPiece(next, 'fast')).toBeUndefined();
  });

  it('Capturador no convierte la Fortaleza, pero la ataca por ocupación y se sacrifica', () => {
    const state = base([
      fortress('fort-amber-close', 1, hex(0, -1)),
      { id: 'capturer', type: 'capturer', owner: 0, position: hex(0, 0) },
      soldier('amber-mobile', 1, hex(2, 0), 3),
    ]);
    expect(
      getLegalActionsForPiece(state, 'capturer').some(
        (action) => action.kind === 'convert' && action.targetId === 'fort-amber-close',
      ),
    ).toBe(false);
    const attack = findAction(
      state,
      'capturer',
      'move',
      (action) => action.targetId === 'fort-amber-close',
    );
    const next = perform(state, attack);
    expect(getPiece(next, 'fort-amber-close')).toMatchObject({ type: 'fortress', hp: 1 });
    expect(getPiece(next, 'capturer')).toBeUndefined();
  });

  it('rechaza un targetId ajeno en un kamikaze', () => {
    const state = base([
      { id: 'airplane', type: 'airplane', owner: 0, position: hex(0, 0), facing: 0 },
      soldier('enemy-ground', 1, hex(0, -2), 3),
      { id: 'enemy-air', type: 'drone', owner: 1, position: hex(0, -2) },
      soldier('unrelated', 1, hex(2, 0), 3),
    ]);
    const result = applyAction(state, {
      kind: 'move',
      pieceId: 'airplane',
      to: hex(0, -2),
      kamikaze: true,
      targetId: 'unrelated',
    });
    expect(result.ok).toBe(false);
  });

  it.each([
    {
      label: 'Tanque',
      piece: { id: 'attacker', type: 'medium', owner: 0, position: hex(0, 0), cannon: 0 } as Piece,
      target: hex(0, -2),
      kind: 'shoot' as const,
    },
    {
      label: 'Lanzamisiles',
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
  ])('$label causa 1 HP a Fortaleza y sobrevive', ({ piece, target, kind }) => {
    const state = base([
      fortress('fort-amber-close', 1, target),
      piece,
      soldier('amber-mobile', 1, hex(4, -1), 3),
    ]);
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
    expect(getPiece(next, 'fort-amber-close')).toMatchObject({ type: 'fortress', hp: 1 });
    expect(getPiece(next, 'attacker')).toBeDefined();
    expect(next.outcome).toBeNull();
  });

  it('una Fortaleza de 3 HP resiste el primer ataque', () => {
    const state = base([
      fortress('fort-amber-close', 1, hex(0, -2), 3),
      { id: 'medium', type: 'medium', owner: 0, position: hex(0, 0), cannon: 0 },
      soldier('amber-mobile', 1, hex(3, 0), 3),
    ]);
    const next = perform(
      state,
      findAction(state, 'medium', 'shoot', (action) => action.targetId === 'fort-amber-close'),
    );
    expect(getPiece(next, 'fort-amber-close')).toMatchObject({ type: 'fortress', hp: 2 });
    expect(next.firstFortressDamageBy).toBe(0);
    expect(next.outcome).toBeNull();
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
    expect(next.history[0].text).toContain('Tanque fue abandonado; el Soldado avanzó');
    expect(getPiece(state, 'medium')?.type).toBe('medium');
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

  it('la tercera repetición declara tablas automáticamente', () => {
    let state = base([
      soldier('blue-soldier', 0, hex(0, -2), 0),
      soldier('amber-soldier', 1, hex(0, 2), 3),
    ]);
    const blueFortress = state.pieces.find(
      (piece) => piece.type === 'fortress' && piece.owner === 0,
    );
    if (blueFortress?.type === 'fortress') blueFortress.hp = 1;
    state.firstFortressDamageBy = 1;
    state.positionCounts = {};

    const rotate = (pieceId: string, facing: Direction): void => {
      if (state.outcome) return;
      state = perform(
        state,
        findAction(state, pieceId, 'rotate', (action) => action.facing === facing),
      );
    };
    for (let cycle = 0; cycle < 3 && !state.outcome; cycle += 1) {
      rotate('blue-soldier', 1);
      rotate('amber-soldier', 4);
      rotate('blue-soldier', 0);
      rotate('amber-soldier', 3);
    }
    expect(state.outcome).toEqual({ type: 'draw', reason: 'repetition' });
    expect(state.history.at(-1)?.text).toContain('Triple repetición');
  });

  it('declara tablas al alcanzar el límite configurable sin progreso', () => {
    let state = base([
      soldier('blue-soldier', 0, hex(0, -2), 0),
      soldier('amber-soldier', 1, hex(0, 2), 3),
    ]);
    const first = applyAction(
      state,
      findAction(state, 'blue-soldier', 'rotate', (action) => action.facing === 1),
      { repetition: null, noProgressPlyLimit: 2 },
    );
    expect(first.state.noProgressPlyCount).toBe(1);
    state = first.state;
    const second = applyAction(
      state,
      findAction(state, 'amber-soldier', 'rotate', (action) => action.facing === 4),
      { repetition: null, noProgressPlyLimit: 2 },
    );
    expect(second.state.noProgressPlyCount).toBe(2);
    expect(second.state.outcome).toEqual({ type: 'draw', reason: 'no-progress' });
    expect(second.events).toContainEqual({ type: 'draw' });
  });

  it('reinicia el contador sin progreso después de una captura o daño a Fortaleza', () => {
    const captureState = base([
      soldier('blue-soldier', 0, hex(0, 0), 0),
      soldier('amber-soldier', 1, hex(0, -1), 3),
    ]);
    captureState.noProgressPlyCount = 9;
    const capture = applyAction(
      captureState,
      findAction(captureState, 'blue-soldier', 'move', (action) => equal(action.to, hex(0, -1))),
      { repetition: null, noProgressPlyLimit: 10 },
    );
    expect(capture.state.noProgressPlyCount).toBe(0);
    expect(capture.state.outcome).toBeNull();

    const damageState = base([
      fortress('fort-amber-close', 1, hex(0, -1), 2),
      soldier('attacker', 0, hex(0, 0), 0),
      soldier('amber-mobile', 1, hex(2, 0), 3),
    ]);
    damageState.noProgressPlyCount = 9;
    const damage = applyAction(
      damageState,
      findAction(damageState, 'attacker', 'move', (action) => equal(action.to, hex(0, -1))),
      { repetition: null, noProgressPlyLimit: 10 },
    );
    expect(damage.state.noProgressPlyCount).toBe(0);
    expect(damage.state.outcome).toBeNull();
  });

  it('bloqueo acordado siempre termina en tablas aunque la vida sea distinta', () => {
    const state = base([], 0);
    state.firstFortressDamageBy = 1;
    const blueFortress = state.pieces.find(
      (piece) => piece.type === 'fortress' && piece.owner === 0,
    );
    if (blueFortress?.type === 'fortress') blueFortress.hp = 1;
    const result = declareBlockade(state);
    expect(result.state.outcome).toEqual({ type: 'draw', reason: 'blockade' });
    expect(result.events).toContainEqual({ type: 'draw' });
  });

  it('conserva el turno rival aunque su única orden disponible sea girar un Soldado', () => {
    const state = base([
      soldier('blue-soldier', 0, hex(0, 0), 0),
      { id: 'amber-aa', type: 'antiAir', owner: 1, position: hex(4, 0) },
      soldier('amber-soldier', 1, hex(0, -5), 0),
    ]);
    const result = applyAction(state, findAction(state, 'blue-soldier', 'rotate'));

    expect(result.state.activePlayer).toBe(1);
    expect(result.events.some((event) => event.type === 'pass')).toBe(false);
    expect(getAllLegalActions(result.state).map((action) => action.kind)).toEqual([
      'rotate',
      'rotate',
      'rotate',
      'rotate',
      'rotate',
    ]);
  });

  it('pasa el turno del rival sin órdenes aunque el jugador anterior pueda seguir actuando', () => {
    const state = base([soldier('blue-soldier', 0, hex(0, 0), 0)]);
    const result = applyAction(state, findAction(state, 'blue-soldier', 'rotate'));

    expect(result.state.activePlayer).toBe(0);
    expect(result.state.outcome).toBeNull();
    expect(result.events).toContainEqual({ type: 'pass', owner: 1 });
    expect(result.state.history.at(-1)?.text).toContain('Ámbar no tiene acciones legales');
  });

  it('declara tablas si, tras pasar un jugador, ninguno puede destruir la Fortaleza rival', () => {
    const state = base([
      { id: 'blue-drone', type: 'drone', owner: 0, position: hex(0, 0) },
      { id: 'amber-aa', type: 'antiAir', owner: 1, position: hex(4, 0) },
    ]);
    const result = applyAction(
      state,
      findAction(state, 'blue-drone', 'move', (action) => equal(action.to, hex(0, -1))),
    );
    expect(result.state.outcome).toEqual({ type: 'draw', reason: 'blockade' });
    expect(result.state.activePlayer).toBe(0);
    expect(result.events).toContainEqual({ type: 'pass', owner: 1 });
  });

  it('declara tablas automáticamente cuando solo quedan aeronaves ante escudos vivos', () => {
    const state = base([
      { id: 'blue-drone', type: 'drone', owner: 0, position: hex(0, 0) },
      { id: 'amber-airplane', type: 'airplane', owner: 1, position: hex(0, 2), facing: 3 },
      { id: 'blue-aa', type: 'antiAir', owner: 0, position: hex(-4, 0) },
      { id: 'amber-aa', type: 'antiAir', owner: 1, position: hex(4, 0) },
    ]);
    const result = applyAction(
      state,
      findAction(state, 'blue-drone', 'move', (action) => equal(action.to, hex(0, -1))),
    );
    expect(result.state.outcome).toEqual({ type: 'draw', reason: 'blockade' });
    expect(result.events).toContainEqual({ type: 'draw' });
  });
});

function equal(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}
