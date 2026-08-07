import {
  ALL_DIRECTIONS,
  DIRECTION_NAMES,
  allBoardHexes,
  directionAtOffset,
  directionBetween,
  equalHex,
  frontDirections,
  hexDistance,
  hexKey,
  isOnBoard,
  stepHex,
} from './hex';
import { createInitialPieces } from './setup';
import type {
  ActionResult,
  BattleLogEntry,
  CellOccupancy,
  Direction,
  GameAction,
  GameEvent,
  GameState,
  Hex,
  Outcome,
  Piece,
  PieceType,
  Player,
  MatchConfig,
} from './types';

export const PIECE_NAMES: Record<PieceType, string> = {
  soldier: 'Soldado',
  capturer: 'Capturador',
  medium: 'Tanque medio',
  long: 'Tanque de largo alcance',
  fast: 'Tanque rápido',
  drone: 'Dron',
  airplane: 'Avión',
  antiAir: 'Escudo antiaéreo',
  fortress: 'Fortaleza',
};

export const PIECE_SHORT_NAMES: Record<PieceType, string> = {
  soldier: 'SOL',
  capturer: 'CAP',
  medium: 'TMA',
  long: 'TLA',
  fast: 'TRP',
  drone: 'DRN',
  airplane: 'AVI',
  antiAir: 'EAA',
  fortress: 'FOR',
};

export const PLAYER_NAMES: Record<Player, string> = {
  0: 'Cian',
  1: 'Ámbar',
};

export function createInitialState(): GameState {
  return createGameState(createInitialPieces(), 0);
}

export function createGameState(pieces: Piece[], activePlayer: Player = 0): GameState {
  validatePieces(pieces);
  const state: GameState = {
    pieces: pieces.map(clonePiece),
    activePlayer,
    ply: 0,
    firstFortressDamageBy: null,
    positionCounts: {},
    outcome: null,
    history: [],
  };
  state.positionCounts[positionHash(state)] = 1;
  return state;
}

export function cloneState(state: GameState): GameState {
  return {
    ...state,
    pieces: state.pieces.map(clonePiece),
    positionCounts: { ...state.positionCounts },
    outcome: state.outcome ? { ...state.outcome } : null,
    history: state.history.map((entry) => ({ ...entry })),
  };
}

function clonePiece(piece: Piece): Piece {
  return { ...piece, position: { ...piece.position } } as Piece;
}

function validatePieces(pieces: Piece[]): void {
  const ids = new Set<string>();
  const cells = new Map<string, { ground: number; air: number }>();
  const fortresses: Record<Player, number> = { 0: 0, 1: 0 };

  for (const piece of pieces) {
    if (ids.has(piece.id)) throw new Error(`ID de unidad duplicado: ${piece.id}`);
    if (!isOnBoard(piece.position)) throw new Error(`Unidad fuera del tablero: ${piece.id}`);
    ids.add(piece.id);

    const key = hexKey(piece.position);
    const count = cells.get(key) ?? { ground: 0, air: 0 };
    if (isAirPiece(piece)) count.air += 1;
    else count.ground += 1;
    if (count.air > 1 || count.ground > 1) throw new Error(`Apilamiento inválido en ${key}`);
    cells.set(key, count);

    if (piece.type === 'fortress') fortresses[piece.owner] += 1;
  }

  if (fortresses[0] !== 1 || fortresses[1] !== 1) {
    throw new Error('La partida necesita exactamente una Fortaleza por jugador.');
  }
}

/** Validates imported, saved, or generated states without mutating them. */
export function validateState(state: GameState, config?: MatchConfig): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const boardCells = config ? new Set(config.board.cells.map(hexKey)) : null;
  const layers = new Map<string, { ground: number; air: number }>();
  for (const piece of state.pieces) {
    if (ids.has(piece.id)) errors.push(`Identificador de pieza duplicado: ${piece.id}.`);
    ids.add(piece.id);
    if (!isOnBoard(piece.position) || (boardCells && !boardCells.has(hexKey(piece.position))))
      errors.push(`La pieza ${piece.id} está fuera del tablero.`);
    const key = hexKey(piece.position);
    const count = layers.get(key) ?? { ground: 0, air: 0 };
    if (isAirPiece(piece)) count.air += 1;
    else count.ground += 1;
    layers.set(key, count);
    if (piece.type === 'fortress' && piece.hp !== 1 && piece.hp !== 2)
      errors.push(`La Fortaleza ${piece.id} tiene puntos de vida inválidos.`);
  }
  for (const [key, count] of layers) {
    if (count.ground > 1) errors.push(`Hay más de una unidad terrestre en ${key}.`);
    if (count.air > 1) errors.push(`Hay más de una unidad aérea en ${key}.`);
  }
  for (const owner of [0, 1] as const) {
    const fortresses = state.pieces.filter(
      (piece) => piece.owner === owner && piece.type === 'fortress',
    );
    if (!state.outcome && fortresses.length !== 1)
      errors.push(`El jugador ${owner} debe tener exactamente una Fortaleza.`);
    if (fortresses.length > 1) errors.push(`El jugador ${owner} tiene varias Fortalezas.`);
  }
  if (state.activePlayer !== 0 && state.activePlayer !== 1)
    errors.push('El jugador activo no es válido.');
  if (!Number.isInteger(state.ply) || state.ply < 0)
    errors.push('El contador de turnos no es válido.');
  return errors;
}

export function getPiece(state: GameState, id: string): Piece | undefined {
  return state.pieces.find((piece) => piece.id === id);
}

export function isGroundPiece(piece: Piece): boolean {
  return !isAirPiece(piece);
}

export function isAirPiece(piece: Piece): boolean {
  return piece.type === 'drone' || piece.type === 'airplane';
}

export function occupancyAt(state: GameState, position: Hex): CellOccupancy {
  const occupancy: CellOccupancy = {};
  for (const piece of state.pieces) {
    if (!equalHex(piece.position, position)) continue;
    if (isAirPiece(piece)) occupancy.air = piece;
    else occupancy.ground = piece;
  }
  return occupancy;
}

export function protectedCells(state: GameState, owner: Player): Set<string> {
  const cells = new Set<string>();
  for (const piece of state.pieces) {
    if (piece.type !== 'antiAir' || piece.owner !== owner) continue;
    cells.add(hexKey(piece.position));
    for (const direction of ALL_DIRECTIONS) {
      const neighbor = stepHex(piece.position, direction);
      if (isOnBoard(neighbor)) cells.add(hexKey(neighbor));
    }
  }
  return cells;
}

export function isProtectedByPlayer(state: GameState, position: Hex, owner: Player): boolean {
  return state.pieces.some(
    (piece) =>
      piece.type === 'antiAir' &&
      piece.owner === owner &&
      hexDistance(piece.position, position) <= 1,
  );
}

export function getLegalActionsForPiece(state: GameState, pieceId: string): GameAction[] {
  const piece = getPiece(state, pieceId);
  if (!piece || state.outcome || piece.owner !== state.activePlayer) return [];

  switch (piece.type) {
    case 'soldier':
      return soldierActions(state, piece);
    case 'capturer':
      return capturerActions(state, piece);
    case 'medium':
      return mediumActions(state, piece);
    case 'long':
      return longActions(state, piece);
    case 'fast':
      return fastActions(state, piece);
    case 'drone':
      return droneActions(state, piece);
    case 'airplane':
      return airplaneActions(state, piece);
    case 'antiAir':
      return antiAirActions();
    case 'fortress':
      return [];
  }
}

export function getPreviewActionsForPiece(state: GameState, pieceId: string): GameAction[] {
  const piece = getPiece(state, pieceId);
  if (!piece || state.outcome) return [];
  if (piece.owner === state.activePlayer) return getLegalActionsForPiece(state, pieceId);
  return getLegalActionsForPiece({ ...state, activePlayer: piece.owner }, pieceId);
}

export function getAllLegalActions(state: GameState): GameAction[] {
  if (state.outcome) return [];
  return state.pieces
    .filter((piece) => piece.owner === state.activePlayer)
    .flatMap((piece) => getLegalActionsForPiece(state, piece.id));
}

export function getFiringRangeCells(
  state: GameState,
  pieceId: string,
  preview: { position?: Hex; cannon?: Direction; facing?: Direction } = {},
): Hex[] {
  const piece = getPiece(state, pieceId);
  if (!piece || !['medium', 'long', 'airplane'].includes(piece.type)) return [];
  const position = preview.position ?? piece.position;
  if (piece.type === 'medium') {
    const cannon = preview.cannon ?? piece.cannon;
    return mediumFiringPaths(state, piece, position, cannon).map(({ target }) => target);
  }
  const enemy = otherPlayer(piece.owner);
  if (piece.type === 'airplane') {
    return airplaneFiringCells(position, preview.facing ?? piece.facing).filter(
      (target) => isOnBoard(target) && !isProtectedByPlayer(state, target, enemy),
    );
  }
  return allBoardHexes().filter(
    (target) =>
      hexDistance(position, target) === 3 &&
      !hexLine(position, target).some((cell) => isProtectedByPlayer(state, cell, enemy)),
  );
}

function soldierActions(
  state: GameState,
  piece: Extract<Piece, { type: 'soldier' }>,
): GameAction[] {
  const actions: GameAction[] = [];
  for (const direction of frontDirections(piece.facing)) {
    const to = stepHex(piece.position, direction);
    if (isOnBoard(to) && canSoldierEnter(state, piece, to)) {
      actions.push({ kind: 'move', pieceId: piece.id, to });
    }
  }
  for (const facing of ALL_DIRECTIONS) {
    if (facing !== piece.facing) actions.push({ kind: 'rotate', pieceId: piece.id, facing });
  }
  const air = occupancyAt(state, piece.position).air;
  if (air && air.owner !== piece.owner) {
    actions.push({ kind: 'attackAbove', pieceId: piece.id, targetId: air.id });
  }
  return actions;
}

function canSoldierEnter(state: GameState, piece: Piece, to: Hex): boolean {
  const occupancy = occupancyAt(state, to);
  if (occupancy.ground) return occupancy.ground.owner !== piece.owner;
  if (occupancy.air) return true;
  return true;
}

function capturerActions(
  state: GameState,
  piece: Extract<Piece, { type: 'capturer' }>,
): GameAction[] {
  const actions: GameAction[] = [];
  for (const direction of ALL_DIRECTIONS) {
    const to = stepHex(piece.position, direction);
    if (!isOnBoard(to)) continue;
    if (canQuietGroundEnter(state, piece, to)) {
      actions.push({ kind: 'move', pieceId: piece.id, to });
    }
    actions.push(...captureActionsAt(state, piece, to));
  }

  const airAbove = occupancyAt(state, piece.position).air;
  if (airAbove && airAbove.owner !== piece.owner && !isProtectedFromCapture(state, airAbove)) {
    actions.push({ kind: 'convert', pieceId: piece.id, targetId: airAbove.id });
  }
  return actions;
}

function captureActionsAt(
  state: GameState,
  capturer: Extract<Piece, { type: 'capturer' }>,
  at: Hex,
): GameAction[] {
  const occupancy = occupancyAt(state, at);
  const groundEnemy = occupancy.ground?.owner !== capturer.owner ? occupancy.ground : undefined;
  const airEnemy = occupancy.air?.owner !== capturer.owner ? occupancy.air : undefined;
  let targets: Piece[] = [];

  if (groundEnemy && airEnemy) targets = [groundEnemy];
  else targets = [groundEnemy, airEnemy].filter((piece): piece is Piece => Boolean(piece));

  return targets
    .filter((target) => target.type === 'fortress' || !isProtectedFromCapture(state, target))
    .map((target) => ({ kind: 'convert', pieceId: capturer.id, targetId: target.id }));
}

function isProtectedFromCapture(state: GameState, target: Piece): boolean {
  return state.pieces.some(
    (piece) =>
      piece.type === 'capturer' &&
      piece.owner === target.owner &&
      piece.id !== target.id &&
      hexDistance(piece.position, target.position) === 1,
  );
}

function mediumActions(state: GameState, piece: Extract<Piece, { type: 'medium' }>): GameAction[] {
  const actions: GameAction[] = [];
  for (const direction of ALL_DIRECTIONS) {
    const to = stepHex(piece.position, direction);
    if (!isOnBoard(to) || !canQuietGroundEnter(state, piece, to)) continue;
    for (const cannon of ALL_DIRECTIONS) {
      actions.push({ kind: 'move', pieceId: piece.id, to, cannon });
    }
  }
  for (const cannon of ALL_DIRECTIONS) {
    if (cannon !== piece.cannon) actions.push({ kind: 'orient', pieceId: piece.id, cannon });
  }
  actions.push(...mediumShootActions(state, piece));
  actions.push(...transformActions(state, piece));
  return actions;
}

function mediumShootActions(
  state: GameState,
  piece: Extract<Piece, { type: 'medium' }>,
): GameAction[] {
  return mediumFiringPaths(state, piece, piece.position, piece.cannon).flatMap(({ target, path }) =>
    shootActionsAtHex(state, piece, target, path),
  );
}

function mediumFiringPaths(
  state: GameState,
  piece: Extract<Piece, { type: 'medium' }>,
  position: Hex,
  cannon: Direction,
): Array<{ target: Hex; path: Hex[] }> {
  const forward = stepHex(position, cannon);
  if (!isOnBoard(forward)) return [];
  const enemy = otherPlayer(piece.owner);
  return [-1, 0, 1]
    .map((offset) => {
      const target = stepHex(forward, directionAtOffset(cannon, offset));
      return { target, path: [forward, target] };
    })
    .filter(
      ({ target, path }) =>
        isOnBoard(target) && !path.some((cell) => isProtectedByPlayer(state, cell, enemy)),
    );
}

function longActions(state: GameState, piece: Extract<Piece, { type: 'long' }>): GameAction[] {
  const actions = adjacentQuietMoves(state, piece);
  for (const target of getFiringRangeCells(state, piece.id)) {
    actions.push(...shootActionsAtHex(state, piece, target));
  }
  actions.push(...transformActions(state, piece));
  return actions;
}

function shootActionsAtHex(
  state: GameState,
  piece: Piece,
  targetHex: Hex,
  path: Hex[] = [],
): GameAction[] {
  if (!isOnBoard(targetHex)) return [];
  const enemy = otherPlayer(piece.owner);
  if (path.some((cell) => isProtectedByPlayer(state, cell, enemy))) return [];
  const occupancy = occupancyAt(state, targetHex);
  return [occupancy.ground, occupancy.air]
    .filter(
      (target): target is Piece =>
        target !== undefined && target.owner !== piece.owner && target.type !== 'antiAir',
    )
    .map((target) => ({ kind: 'shoot', pieceId: piece.id, targetId: target.id }));
}

function hexLine(from: Hex, to: Hex): Hex[] {
  const distance = hexDistance(from, to);
  const cells: Hex[] = [];
  for (let index = 1; index <= distance; index += 1) {
    const amount = index / distance;
    const q = from.q + (to.q - from.q) * amount;
    const r = from.r + (to.r - from.r) * amount;
    cells.push(roundHex(q + 1e-6, r + 2e-6));
  }
  return cells;
}

function roundHex(q: number, r: number): Hex {
  const x = q;
  const z = r;
  const y = -x - z;
  let roundedX = Math.round(x);
  let roundedY = Math.round(y);
  let roundedZ = Math.round(z);
  const xDiff = Math.abs(roundedX - x);
  const yDiff = Math.abs(roundedY - y);
  const zDiff = Math.abs(roundedZ - z);
  if (xDiff > yDiff && xDiff > zDiff) roundedX = -roundedY - roundedZ;
  else if (yDiff > zDiff) roundedY = -roundedX - roundedZ;
  else roundedZ = -roundedX - roundedY;
  return { q: roundedX, r: roundedZ };
}

function fastActions(state: GameState, piece: Extract<Piece, { type: 'fast' }>): GameAction[] {
  const actions: GameAction[] = [];
  for (const direction of ALL_DIRECTIONS) {
    for (let distance = 1; distance <= 10; distance += 1) {
      const to = stepHex(piece.position, direction, distance);
      if (!isOnBoard(to)) break;
      const occupancy = occupancyAt(state, to);

      if (occupancy.ground) {
        if (occupancy.ground.owner !== piece.owner) {
          actions.push({ kind: 'move', pieceId: piece.id, to });
        }
        break;
      }

      if (occupancy.air?.owner !== undefined && occupancy.air.owner !== piece.owner) {
        actions.push({ kind: 'move', pieceId: piece.id, to });
        break;
      }

      actions.push({ kind: 'move', pieceId: piece.id, to });
    }
  }
  const air = occupancyAt(state, piece.position).air;
  if (air && air.owner !== piece.owner) {
    actions.push({ kind: 'attackAbove', pieceId: piece.id, targetId: air.id });
  }
  actions.push(...transformActions(state, piece));
  return actions;
}

function droneActions(state: GameState, piece: Extract<Piece, { type: 'drone' }>): GameAction[] {
  const actions: GameAction[] = [];
  const groundBelow = occupancyAt(state, piece.position).ground;
  if (groundBelow && groundBelow.owner !== piece.owner) {
    actions.push({ kind: 'attackBelow', pieceId: piece.id, targetId: groundBelow.id });
  }
  const enemy = otherPlayer(piece.owner);
  for (const direction of ALL_DIRECTIONS) {
    for (let distance = 1; distance <= 3; distance += 1) {
      const to = stepHex(piece.position, direction, distance);
      if (!isOnBoard(to)) break;

      if (isProtectedByPlayer(state, to, enemy)) {
        actions.push({ kind: 'move', pieceId: piece.id, to });
        break;
      }

      const air = occupancyAt(state, to).air;
      if (air) {
        if (air.type === 'drone' && air.owner !== piece.owner) {
          actions.push({ kind: 'move', pieceId: piece.id, to });
        }
        break;
      }
      actions.push({ kind: 'move', pieceId: piece.id, to });
    }
  }
  return actions;
}

function airplaneActions(
  state: GameState,
  piece: Extract<Piece, { type: 'airplane' }>,
): GameAction[] {
  const actions: GameAction[] = [];
  const enemy = otherPlayer(piece.owner);

  for (const direction of frontDirections(piece.facing)) {
    for (let distance = 1; distance <= 2; distance += 1) {
      const to = stepHex(piece.position, direction, distance);
      if (!isOnBoard(to)) break;
      if (isProtectedByPlayer(state, to, enemy)) {
        actions.push({ kind: 'move', pieceId: piece.id, to });
        break;
      }
      const air = occupancyAt(state, to).air;
      if (air) {
        if (air.owner !== piece.owner) {
          actions.push({ kind: 'move', pieceId: piece.id, to, kamikaze: true });
        }
        break;
      }
      actions.push({ kind: 'move', pieceId: piece.id, to });
      const ground = occupancyAt(state, to).ground;
      if (ground && ground.owner !== piece.owner) {
        actions.push({ kind: 'move', pieceId: piece.id, to, kamikaze: true });
      }
    }
  }

  for (const target of getFiringRangeCells(state, piece.id)) {
    actions.push(...shootActionsAtHex(state, piece, target));
  }
  return actions;
}

function airplaneFiringCells(origin: Hex, facing: Direction): Hex[] {
  const cells = new Map<string, Hex>();
  const forwardOne = stepHex(origin, facing);
  const forwardTwo = stepHex(origin, facing, 2);
  for (const direction of frontDirections(facing)) {
    const inner = stepHex(forwardOne, direction);
    cells.set(hexKey(inner), inner);
  }
  for (const offset of [-1, 0, 1] as const) {
    const outer = stepHex(forwardTwo, directionAtOffset(facing, offset));
    cells.set(hexKey(outer), outer);
  }
  for (const offset of [-1, 1] as const) {
    const outerEdge = stepHex(forwardOne, directionAtOffset(facing, offset), 2);
    cells.set(hexKey(outerEdge), outerEdge);
  }
  return [...cells.values()];
}

function antiAirActions(): GameAction[] {
  return [];
}

function adjacentQuietMoves(state: GameState, piece: Piece): GameAction[] {
  const actions: GameAction[] = [];
  for (const direction of ALL_DIRECTIONS) {
    const to = stepHex(piece.position, direction);
    if (isOnBoard(to) && canQuietGroundEnter(state, piece, to)) {
      actions.push({ kind: 'move', pieceId: piece.id, to });
    }
  }
  return actions;
}

function canQuietGroundEnter(state: GameState, piece: Piece, to: Hex): boolean {
  const occupancy = occupancyAt(state, to);
  return !occupancy.ground && (!occupancy.air || occupancy.air.owner === piece.owner);
}

function transformActions(
  state: GameState,
  piece: Extract<Piece, { type: 'medium' | 'long' | 'fast' }>,
): GameAction[] {
  const actions: GameAction[] = [];
  const airAbove = occupancyAt(state, piece.position).air;
  for (const facing of ALL_DIRECTIONS) {
    actions.push({ kind: 'transform', pieceId: piece.id, facing });
    if (airAbove && airAbove.owner !== piece.owner) {
      actions.push({
        kind: 'transform',
        pieceId: piece.id,
        facing,
        attackAboveId: airAbove.id,
      });
    }
    const soldier = {
      id: piece.id,
      type: 'soldier' as const,
      owner: piece.owner,
      position: piece.position,
      facing,
    };
    for (const direction of frontDirections(facing)) {
      const to = stepHex(piece.position, direction);
      if (isOnBoard(to) && canSoldierEnter(state, soldier, to)) {
        actions.push({ kind: 'transform', pieceId: piece.id, facing, to });
      }
    }
  }
  return actions;
}

export function applyAction(state: GameState, action: GameAction): ActionResult {
  if (state.outcome) return failure(state, 'La partida ya ha terminado.');
  const legal = getLegalActionsForPiece(state, action.pieceId);
  const canonical = actionKey(action);
  if (!legal.some((candidate) => actionKey(candidate) === canonical)) {
    return failure(state, 'Esa orden no es legal en la posición actual.');
  }

  const before = cloneState(state);
  const next = cloneState(state);
  const events: GameEvent[] = [];
  const actor = getPiece(next, action.pieceId);
  if (!actor) return failure(state, 'La unidad ya no está disponible.');

  executeAction(next, action, events);
  purgeAirUnitsInEnemyZones(next, events);
  next.ply += 1;
  next.history.push({
    id: next.ply,
    player: state.activePlayer,
    text: describeResolvedAction(before, action, events),
  });
  if (next.history.length > 80) next.history.shift();

  const defeated = findDefeatedPlayer(next);
  if (defeated !== null) {
    next.outcome = { type: 'win', winner: otherPlayer(defeated), reason: 'fortress' };
    events.push({ type: 'victory', owner: otherPlayer(defeated) });
    return { ok: true, state: next, events };
  }

  next.activePlayer = otherPlayer(next.activePlayer);
  const hash = positionHash(next);
  const repetitions = (next.positionCounts[hash] ?? 0) + 1;
  next.positionCounts[hash] = repetitions;

  if (repetitions >= 3) {
    finishByBlockade(next, 'repetition', events);
  } else if (getAllLegalActions(next).length === 0) {
    finishByBlockade(next, 'blockade', events);
  }

  return { ok: true, state: next, events };
}

function executeAction(state: GameState, action: GameAction, events: GameEvent[]): void {
  const piece = getPiece(state, action.pieceId);
  if (!piece) return;

  switch (action.kind) {
    case 'rotate':
      if (piece.type === 'soldier') {
        piece.facing = action.facing;
        events.push({ type: 'rotate', pieceId: piece.id, owner: piece.owner, at: piece.position });
      }
      return;
    case 'orient':
      if (piece.type === 'medium') {
        piece.cannon = action.cannon;
        events.push({ type: 'rotate', pieceId: piece.id, owner: piece.owner, at: piece.position });
      }
      return;
    case 'shoot': {
      const target = getPiece(state, action.targetId);
      if (!target) return;
      events.push({
        type: 'shoot',
        pieceId: piece.id,
        targetId: target.id,
        owner: piece.owner,
        from: { ...piece.position },
        to: { ...target.position },
      });
      resolveHit(state, piece.id, target.id, events);
      return;
    }
    case 'convert': {
      const target = getPiece(state, action.targetId);
      if (!target) return;
      if (target.type === 'fortress') {
        resolveHit(state, piece.id, target.id, events);
      } else {
        target.owner = piece.owner;
        events.push({
          type: 'convert',
          pieceId: piece.id,
          targetId: target.id,
          owner: piece.owner,
          at: { ...target.position },
        });
      }
      return;
    }
    case 'attackAbove':
    case 'attackBelow':
      resolveHit(state, piece.id, action.targetId, events);
      return;
    case 'transform': {
      const index = state.pieces.findIndex((candidate) => candidate.id === piece.id);
      const soldier: Extract<Piece, { type: 'soldier' }> = {
        id: piece.id,
        type: 'soldier',
        owner: piece.owner,
        position: { ...piece.position },
        facing: action.facing,
      };
      state.pieces[index] = soldier;
      events.push({
        type: 'transform',
        pieceId: soldier.id,
        owner: soldier.owner,
        at: { ...soldier.position },
      });
      if (action.attackAboveId) resolveHit(state, soldier.id, action.attackAboveId, events);
      else if (action.to) resolveGroundCombatMove(state, soldier, action.to, events);
      return;
    }
    case 'move':
      if (piece.type === 'drone') resolveDroneMove(state, piece, action.to, events);
      else if (piece.type === 'airplane')
        resolveAirplaneMove(state, piece, action.to, Boolean(action.kamikaze), events);
      else if (piece.type === 'soldier' || piece.type === 'fast') {
        resolveGroundCombatMove(state, piece, action.to, events);
      } else if (piece.type === 'antiAir') {
        resolveAntiAirMove(state, piece, action.to, events);
      } else {
        resolveQuietMove(piece, action.to, events);
        if (piece.type === 'medium' && action.cannon !== undefined) piece.cannon = action.cannon;
      }
  }
}

function resolveAirplaneMove(
  state: GameState,
  piece: Extract<Piece, { type: 'airplane' }>,
  to: Hex,
  kamikaze: boolean,
  events: GameEvent[],
): void {
  const from = { ...piece.position };
  const line = findLine(from, to, 2);
  if (!line) return;
  for (let distance = 1; distance <= line.distance; distance += 1) {
    const at = stepHex(from, line.direction, distance);
    if (!isProtectedByPlayer(state, at, otherPlayer(piece.owner))) continue;
    events.push({ type: 'move', pieceId: piece.id, owner: piece.owner, from, to: { ...at } });
    removePiece(state, piece.id);
    events.push({
      type: 'intercept',
      pieceId: piece.id,
      targetId: piece.id,
      owner: otherPlayer(piece.owner),
      at: { ...at },
    });
    return;
  }

  events.push({ type: 'move', pieceId: piece.id, owner: piece.owner, from, to: { ...to } });
  const occupancy = occupancyAt(state, to);
  const target = kamikaze
    ? occupancy.air?.owner !== undefined && occupancy.air.owner !== piece.owner
      ? occupancy.air
      : occupancy.ground?.owner !== undefined && occupancy.ground.owner !== piece.owner
        ? occupancy.ground
        : undefined
    : undefined;
  if (kamikaze && target) {
    const at = { ...target.position };
    removePiece(state, target.id);
    removePiece(state, piece.id);
    events.push({
      type: 'destroy',
      pieceId: piece.id,
      targetId: target.id,
      owner: piece.owner,
      at,
    });
    events.push({
      type: 'destroy',
      pieceId: piece.id,
      targetId: piece.id,
      owner: otherPlayer(piece.owner),
      at,
    });
    return;
  }
  piece.position = { ...to };
  piece.facing = line.direction;
}

function resolveQuietMove(piece: Piece, to: Hex, events: GameEvent[]): void {
  const from = { ...piece.position };
  piece.position = { ...to };
  events.push({ type: 'move', pieceId: piece.id, owner: piece.owner, from, to: { ...to } });
}

function resolveGroundCombatMove(
  state: GameState,
  piece: Extract<Piece, { type: 'soldier' | 'fast' }>,
  to: Hex,
  events: GameEvent[],
): void {
  const from = { ...piece.position };
  events.push({ type: 'move', pieceId: piece.id, owner: piece.owner, from, to: { ...to } });
  const occupancy = occupancyAt(state, to);
  const enemyGround =
    occupancy.ground && occupancy.ground.owner !== piece.owner ? occupancy.ground : undefined;
  const enemyAir = occupancy.air && occupancy.air.owner !== piece.owner ? occupancy.air : undefined;
  const target = enemyGround ?? (!occupancy.ground ? enemyAir : undefined);
  if (target) resolveHit(state, piece.id, target.id, events);

  const survivor = getPiece(state, piece.id);
  if (survivor?.type === 'soldier' || survivor?.type === 'fast') {
    survivor.position = { ...to };
    if (survivor.type === 'soldier') {
      const direction = directionBetween(from, to);
      if (direction !== null) survivor.facing = direction;
    }
  }
}

function resolveDroneMove(
  state: GameState,
  piece: Extract<Piece, { type: 'drone' }>,
  to: Hex,
  events: GameEvent[],
): void {
  const from = { ...piece.position };
  const line = findLine(from, to, 3);
  if (line) {
    for (let distance = 1; distance <= line.distance; distance += 1) {
      const at = stepHex(from, line.direction, distance);
      if (!isProtectedByPlayer(state, at, otherPlayer(piece.owner))) continue;
      events.push({ type: 'move', pieceId: piece.id, owner: piece.owner, from, to: { ...at } });
      removePiece(state, piece.id);
      events.push({
        type: 'intercept',
        pieceId: piece.id,
        targetId: piece.id,
        owner: otherPlayer(piece.owner),
        at: { ...at },
      });
      return;
    }
  }

  events.push({ type: 'move', pieceId: piece.id, owner: piece.owner, from, to: { ...to } });
  const occupancy = occupancyAt(state, to);
  const enemyAir = occupancy.air && occupancy.air.owner !== piece.owner ? occupancy.air : undefined;
  const enemyGround =
    occupancy.ground && occupancy.ground.owner !== piece.owner ? occupancy.ground : undefined;
  const target = enemyAir ?? enemyGround;
  if (target) resolveHit(state, piece.id, target.id, events);
  const survivor = getPiece(state, piece.id);
  if (survivor?.type === 'drone') survivor.position = { ...to };
}

function resolveAntiAirMove(
  state: GameState,
  piece: Extract<Piece, { type: 'antiAir' }>,
  to: Hex,
  events: GameEvent[],
): void {
  const from = { ...piece.position };
  events.push({ type: 'move', pieceId: piece.id, owner: piece.owner, from, to: { ...to } });
  const ground = occupancyAt(state, to).ground;
  if (ground && ground.owner !== piece.owner && ground.type === 'fortress') {
    resolveHit(state, piece.id, ground.id, events);
  }
  const survivor = getPiece(state, piece.id);
  if (survivor?.type === 'antiAir') survivor.position = { ...to };
}

function resolveHit(
  state: GameState,
  attackerId: string,
  targetId: string,
  events: GameEvent[],
): void {
  const attacker = getPiece(state, attackerId);
  const target = getPiece(state, targetId);
  if (!attacker || !target) return;

  if (target.type === 'fortress') {
    const sacrifice = attacker.type === 'soldier' || attacker.type === 'capturer';
    const damage = sacrifice ? 1 : 2;
    const targetAt = { ...target.position };
    const previousHp = target.hp;
    if (previousHp === 2 && damage === 1 && state.firstFortressDamageBy === null) {
      state.firstFortressDamageBy = attacker.owner;
    }
    events.push({
      type: 'fortressDamage',
      pieceId: attacker.id,
      targetId: target.id,
      owner: attacker.owner,
      at: targetAt,
      amount: damage,
    });

    if (previousHp - damage <= 0) {
      removePiece(state, target.id);
      events.push({
        type: 'destroy',
        pieceId: attacker.id,
        targetId: target.id,
        owner: attacker.owner,
        at: targetAt,
      });
    } else {
      target.hp = 1;
    }

    if (sacrifice) {
      const attackerAt = { ...attacker.position };
      removePiece(state, attacker.id);
      events.push({
        type: 'destroy',
        pieceId: attacker.id,
        targetId: attacker.id,
        owner: otherPlayer(attacker.owner),
        at: attackerAt,
      });
    }
    return;
  }

  const at = { ...target.position };
  removePiece(state, target.id);
  events.push({
    type: 'destroy',
    pieceId: attacker.id,
    targetId: target.id,
    owner: attacker.owner,
    at,
  });
}

function purgeAirUnitsInEnemyZones(state: GameState, events: GameEvent[]): void {
  const airUnits = state.pieces.filter(isAirPiece);
  for (const unit of airUnits) {
    if (!getPiece(state, unit.id)) continue;
    if (!isProtectedByPlayer(state, unit.position, otherPlayer(unit.owner))) continue;
    const at = { ...unit.position };
    removePiece(state, unit.id);
    events.push({
      type: 'intercept',
      pieceId: unit.id,
      targetId: unit.id,
      owner: otherPlayer(unit.owner),
      at,
    });
  }
}

function removePiece(state: GameState, pieceId: string): void {
  const index = state.pieces.findIndex((piece) => piece.id === pieceId);
  if (index >= 0) state.pieces.splice(index, 1);
}

function findLine(
  from: Hex,
  to: Hex,
  maxDistance: number,
): { direction: Direction; distance: number } | null {
  for (const direction of ALL_DIRECTIONS) {
    for (let distance = 1; distance <= maxDistance; distance += 1) {
      if (equalHex(stepHex(from, direction, distance), to)) return { direction, distance };
    }
  }
  return null;
}

function findDefeatedPlayer(state: GameState): Player | null {
  for (const player of [0, 1] as const) {
    if (!state.pieces.some((piece) => piece.type === 'fortress' && piece.owner === player)) {
      return player;
    }
  }
  return null;
}

function finishByBlockade(
  state: GameState,
  reason: 'blockade' | 'repetition',
  events: GameEvent[],
): void {
  const fortresses = state.pieces.filter(
    (piece): piece is Extract<Piece, { type: 'fortress' }> => piece.type === 'fortress',
  );
  const intact = fortresses.length === 2 && fortresses.every((fortress) => fortress.hp === 2);
  if (intact || state.firstFortressDamageBy === null) {
    state.outcome = { type: 'draw', reason };
    events.push({ type: 'draw' });
    state.history.push({
      id: state.ply + 1,
      player: state.activePlayer,
      text: 'Bloqueo confirmado: tablas.',
    });
  } else {
    state.outcome = { type: 'win', winner: state.firstFortressDamageBy, reason };
    events.push({ type: 'victory', owner: state.firstFortressDamageBy });
    state.history.push({
      id: state.ply + 1,
      player: state.firstFortressDamageBy,
      text: `${PLAYER_NAMES[state.firstFortressDamageBy]} vence por primer daño a Fortaleza.`,
    });
  }
}

export function declareBlockade(state: GameState): ActionResult {
  if (state.outcome) return failure(state, 'La partida ya ha terminado.');
  const next = cloneState(state);
  const events: GameEvent[] = [];
  finishByBlockade(next, 'blockade', events);
  return { ok: true, state: next, events };
}

function positionHash(state: GameState): string {
  const pieces = state.pieces
    .map((piece) => {
      const facing = piece.type === 'soldier' || piece.type === 'airplane' ? piece.facing : '-';
      const cannon = piece.type === 'medium' ? piece.cannon : '-';
      const hp = piece.type === 'fortress' ? piece.hp : '-';
      return `${piece.owner}:${piece.type}:${piece.position.q}:${piece.position.r}:${facing}:${cannon}:${hp}`;
    })
    .sort()
    .join('|');
  return `${state.activePlayer}@${state.firstFortressDamageBy ?? '-'}@${pieces}`;
}

function actionKey(action: GameAction): string {
  switch (action.kind) {
    case 'move':
      return `move:${action.pieceId}:${hexKey(action.to)}:${action.cannon ?? '-'}:${action.kamikaze ? 'k' : '-'}`;
    case 'rotate':
      return `rotate:${action.pieceId}:${action.facing}`;
    case 'orient':
      return `orient:${action.pieceId}:${action.cannon}`;
    case 'shoot':
      return `shoot:${action.pieceId}:${action.targetId}`;
    case 'convert':
      return `convert:${action.pieceId}:${action.targetId}`;
    case 'attackAbove':
    case 'attackBelow':
      return `${action.kind}:${action.pieceId}:${action.targetId}`;
    case 'transform':
      return `transform:${action.pieceId}:${action.facing}:${action.to ? hexKey(action.to) : '-'}:${action.attackAboveId ?? '-'}`;
  }
}

export function actionDestination(state: GameState, action: GameAction): Hex | null {
  switch (action.kind) {
    case 'move':
      return action.to;
    case 'shoot':
    case 'convert':
    case 'attackAbove':
    case 'attackBelow':
      return getPiece(state, action.targetId)?.position ?? null;
    case 'transform':
      if (action.to) return action.to;
      if (action.attackAboveId) return getPiece(state, action.attackAboveId)?.position ?? null;
      return getPiece(state, action.pieceId)?.position ?? null;
    case 'rotate':
    case 'orient':
      return getPiece(state, action.pieceId)?.position ?? null;
  }
}

export function describeAction(state: GameState, action: GameAction): string {
  const piece = getPiece(state, action.pieceId);
  if (!piece) return 'Orden no disponible';
  const name = PIECE_NAMES[piece.type];
  switch (action.kind) {
    case 'move': {
      const destination = occupancyAt(state, action.to);
      const enemyGround =
        destination.ground && destination.ground.owner !== piece.owner
          ? destination.ground
          : undefined;
      const enemyAir =
        destination.air && destination.air.owner !== piece.owner ? destination.air : undefined;
      const target = isAirPiece(piece) ? (enemyAir ?? enemyGround) : (enemyGround ?? enemyAir);
      if (isAirPiece(piece) && isProtectedByPlayer(state, action.to, otherPlayer(piece.owner))) {
        return `Incursión de ${name}: intercepción AA en ${formatHex(action.to)}`;
      }
      if (piece.type === 'airplane' && action.kamikaze && target) {
        return `${name} realizará un kamikaze contra ${PIECE_NAMES[target.type]} en ${formatHex(action.to)}`;
      }
      if (piece.type === 'airplane' && destination.ground) {
        return `${name} sobrevolará ${PIECE_NAMES[destination.ground.type]} en ${formatHex(action.to)}`;
      }
      return target
        ? `${name} atacará ${PIECE_NAMES[target.type]} en ${formatHex(action.to)}`
        : `${name} se moverá a ${formatHex(action.to)}`;
    }
    case 'rotate':
      return `${name} girará hacia ${directionNameForPlayer(action.facing, piece?.owner ?? state.activePlayer)}`;
    case 'orient':
      return `Cañón orientado hacia ${directionNameForPlayer(action.cannon, piece?.owner ?? state.activePlayer)}`;
    case 'shoot': {
      const target = getPiece(state, action.targetId);
      return `${name} disparará a ${target ? PIECE_NAMES[target.type] : 'objetivo'}`;
    }
    case 'convert': {
      const target = getPiece(state, action.targetId);
      return target?.type === 'fortress'
        ? `${name} saboteará la Fortaleza y se sacrificará`
        : `${name} convertirá ${target ? PIECE_NAMES[target.type] : 'objetivo'}`;
    }
    case 'attackAbove':
      return `${name} neutralizará la aeronave situada encima`;
    case 'attackBelow':
      return `${name} atacará la unidad terrestre situada debajo`;
    case 'transform':
      if (action.attackAboveId)
        return `${name} será abandonado; el Soldado atacará el Dron superior`;
      if (action.to)
        return `${name} será abandonado; el Soldado avanzará a ${formatHex(action.to)}`;
      return `${name} será abandonado y se convertirá en Soldado`;
  }
}

function describeResolvedAction(
  before: GameState,
  action: GameAction,
  events: GameEvent[],
): string {
  const piece = getPiece(before, action.pieceId);
  const name = piece ? PIECE_NAMES[piece.type] : 'Unidad';
  let base: string;
  switch (action.kind) {
    case 'move':
      base =
        piece?.type === 'airplane' && action.kamikaze
          ? `${name} ejecutó un ataque kamikaze en ${formatHex(action.to)}`
          : piece?.type === 'airplane' && occupancyAt(before, action.to).ground
            ? `${name} sobrevoló una unidad en ${formatHex(action.to)}`
            : `${name} avanzó a ${formatHex(action.to)}`;
      break;
    case 'rotate':
      base = `${name} giró hacia ${directionNameForPlayer(action.facing, piece?.owner ?? before.activePlayer)}`;
      break;
    case 'orient':
      base = `Cañón orientado hacia ${directionNameForPlayer(action.cannon, piece?.owner ?? before.activePlayer)}`;
      break;
    case 'shoot': {
      const target = getPiece(before, action.targetId);
      base = `${name} disparó contra ${target ? PIECE_NAMES[target.type] : 'objetivo'}`;
      break;
    }
    case 'convert': {
      const target = getPiece(before, action.targetId);
      base =
        target?.type === 'fortress'
          ? `${name} saboteó la Fortaleza`
          : `${name} convirtió ${target ? PIECE_NAMES[target.type] : 'objetivo'}`;
      break;
    }
    case 'attackAbove':
      base = `${name} neutralizó la aeronave superior`;
      break;
    case 'attackBelow':
      base = `${name} neutralizó la unidad inferior`;
      break;
    case 'transform':
      base = action.to
        ? `${name} fue abandonado; el Soldado avanzó a ${formatHex(action.to)}`
        : action.attackAboveId
          ? `${name} fue abandonado; el Soldado neutralizó el Dron superior`
          : `${name} fue abandonado y convertido en Soldado`;
      break;
  }
  const destroyed = events.filter(
    (event) => event.type === 'destroy' || event.type === 'intercept',
  ).length;
  const fortressDamage = events.find((event) => event.type === 'fortressDamage');
  const suffix = fortressDamage
    ? ` Fortaleza: −${fortressDamage.amount ?? 0} HP.`
    : destroyed > 0
      ? ` ${destroyed} baja${destroyed === 1 ? '' : 's'}.`
      : '.';
  return `${base}${suffix}`;
}

function directionNameForPlayer(direction: Direction, player: Player): string {
  return DIRECTION_NAMES[((direction + (player === 0 ? 3 : 0)) % 6) as Direction];
}

function formatHex(hex: Hex): string {
  const q = hex.q >= 0 ? `+${hex.q}` : `${hex.q}`;
  const r = hex.r >= 0 ? `+${hex.r}` : `${hex.r}`;
  return `[${q}, ${r}]`;
}

function otherPlayer(player: Player): Player {
  return player === 0 ? 1 : 0;
}

function failure(state: GameState, error: string): ActionResult {
  return { ok: false, state, events: [], error };
}

export function outcomeText(outcome: Outcome): string {
  if (outcome.type === 'draw') {
    return outcome.reason === 'repetition' ? 'Tablas por triple repetición' : 'Tablas por bloqueo';
  }
  const cause =
    outcome.reason === 'fortress'
      ? 'Fortaleza destruida'
      : outcome.reason === 'repetition'
        ? 'Primer daño y triple repetición'
        : 'Primer daño y bloqueo';
  return `${PLAYER_NAMES[outcome.winner]} vence · ${cause}`;
}

export function battleLogEntry(state: GameState, indexFromEnd = 0): BattleLogEntry | undefined {
  return state.history[state.history.length - 1 - indexFromEnd];
}

export function otherPlayerOf(player: Player): Player {
  return otherPlayer(player);
}
