import {
  DIRECTION_NAMES,
  HEX_HEIGHT,
  HEX_WIDTH,
  directionBetween,
  equalHex,
  hexKey,
  hexToWorld,
} from '../hex';
import {
  PIECE_SHORT_NAMES,
  actionDestination,
  firstAirInterception,
  getPiece,
  isAirPiece,
  isProtectedByPlayer,
  occupancyAt,
  otherPlayerOf,
} from '../engine';
import type { Direction, GameAction, GameEvent, GameState, Hex, Piece, Player } from '../types';

export const COLORS = {
  background: '#07131a',
  panel: '#0d2029',
  cellA: '#102832',
  cellB: '#13303a',
  grid: '#668087',
  text: '#f3ebdd',
  muted: '#9fb0b1',
  blue: '#36b9ff',
  amber: '#ffb547',
  move: '#55e0c1',
  attack: '#ff174f',
  range: '#ff174f',
  convert: '#b8a1ff',
  danger: '#ff765c',
  threat: '#ffd166',
};

export const DEPTH_BOARD_TILT = 0.72;
export const TILE_DEPTH = 7;
export const GROUND_LIFT = 4;
export const AIR_LIFT = 27;
export const DEPTH_TRANSITION_DURATION = 420;

export interface RenderModel {
  state: GameState;
  fortressMaxHp: [1 | 2 | 3, 1 | 2 | 3];
  selectedId: string | null;
  actions: GameAction[];
  pending: GameAction | null;
  /** Visual intent in instructional scenes; does not change the action sent to the engine. */
  pendingDestination?: Hex | null;
  hovered: Hex | null;
  focused: Hex | null;
  firingRange: Hex[];
  lastEvents: GameEvent[];
  threatenedCells: Hex[];
  reducedMotion: boolean;
  highContrast: boolean;
  /** Ambient motion is opt-in so instructional scenes and previews remain still. */
  idleAnimations?: boolean;
  /** Explicit tutorial target; the screen label supplements the persistent cell outline. */
  tutorialCue?: { hex: Hex; label: string } | null;
}

export type MarkerKind = 'range' | 'move' | 'capture' | 'shoot' | 'convert' | 'danger';

export interface ActionMarker {
  hex: Hex;
  kind: MarkerKind;
  owner?: Player;
  hasRange: boolean;
  canMove: boolean;
  canAttack: boolean;
}

/** Visual pose only: turn at the origin, then travel in the new direction. */
export function movementPose(
  piece: Piece,
  from: Hex,
  to: Hex,
  progress: number,
): {
  travel: number;
  rotation: number;
} {
  const direction = directionBetween(from, to);
  const delta =
    (piece.type === 'soldier' || piece.type === 'airplane') && direction !== null
      ? ((direction - piece.facing + 9) % 6) - 3
      : 0;
  const turnFraction = delta === 0 ? 0 : 0.25;
  const turn = turnFraction === 0 ? 1 : Math.min(1, progress / turnFraction);
  const travel = Math.max(0, (progress - turnFraction) / (1 - turnFraction));
  return {
    travel: 1 - (1 - travel) ** 3,
    rotation: delta * (Math.PI / 3) * (1 - (1 - turn) ** 3),
  };
}

export function actionMarkers(model: RenderModel): Map<string, ActionMarker> {
  const byCell = new Map<string, ActionMarker>();
  for (const hex of model.firingRange) {
    byCell.set(hexKey(hex), {
      hex,
      kind: 'range',
      hasRange: true,
      canMove: false,
      canAttack: false,
    });
  }
  for (const action of model.actions) {
    // In-place controls are not capture targets.
    if (
      action.kind === 'rotate' ||
      action.kind === 'orient' ||
      (action.kind === 'transform' && !action.to && !action.attackAboveId)
    )
      continue;
    const destination = actionDestination(model.state, action);
    if (!destination) continue;
    const kind = markerKind(model.state, action);
    const piece = getPiece(model.state, action.pieceId);
    const key = hexKey(destination);
    const current = byCell.get(key);
    const canMove = action.kind === 'move' && !action.kamikaze && kind !== 'danger';
    const canAttack =
      kind === 'capture' ||
      kind === 'shoot' ||
      (action.kind === 'move' && Boolean(action.kamikaze));
    if (!current || markerPriority(kind) > markerPriority(current.kind)) {
      byCell.set(key, {
        hex: destination,
        kind,
        owner: piece?.owner,
        hasRange: current?.hasRange ?? false,
        canMove: (current?.canMove ?? false) || canMove,
        canAttack: (current?.canAttack ?? false) || canAttack,
      });
    } else {
      current.canMove ||= canMove;
      current.canAttack ||= canAttack;
    }
  }
  return byCell;
}

export function markerColor(marker: ActionMarker): string {
  if (marker.kind === 'convert' && marker.owner !== undefined) {
    return marker.owner === 0 ? COLORS.blue : COLORS.amber;
  }
  if (marker.kind === 'capture' || marker.kind === 'shoot') return COLORS.attack;
  return COLORS[marker.kind];
}

export function markerKind(state: GameState, action: GameAction): MarkerKind {
  const piece = getPiece(state, action.pieceId);
  if (!piece) return 'move';
  if (action.kind === 'shoot') return 'shoot';
  if (action.kind === 'attackAbove' || action.kind === 'attackBelow') return 'capture';
  if (action.kind === 'convert') return 'convert';
  if (action.kind === 'transform') {
    if (action.attackAboveId) return 'capture';
    if (!action.to) return 'convert';
    const occupancy = occupancyAt(state, action.to);
    if (occupancy.ground?.owner !== undefined && occupancy.ground.owner !== piece.owner)
      return 'capture';
    if (occupancy.air?.type === 'drone' && occupancy.air.owner !== piece.owner) return 'capture';
    return 'move';
  }
  if (action.kind === 'rotate' || action.kind === 'orient') return 'convert';
  if (firstAirInterception(state, piece, action.to)) {
    return 'danger';
  }
  if (piece.type === 'airplane' && action.kind === 'move') {
    return action.kamikaze ? 'capture' : 'move';
  }
  if (action.kind === 'move' && action.targetId) return 'capture';
  const occupancy = occupancyAt(state, action.to);
  if (occupancy.ground?.owner !== undefined && occupancy.ground.owner !== piece.owner)
    return 'capture';
  if (
    occupancy.air?.owner !== undefined &&
    occupancy.air.owner !== piece.owner &&
    (isAirPiece(piece) || occupancy.air.type === 'drone')
  )
    return 'capture';
  return 'move';
}

function markerPriority(kind: MarkerKind): number {
  return { range: -1, move: 0, convert: 1, danger: 2, capture: 3, shoot: 4 }[kind];
}

export function eventDuration(events: GameEvent[]): number {
  if (events.some((event) => event.type === 'victory')) return 900;
  if (events.some((event) => event.type === 'fortressDamage')) return 720;
  if (events.some((event) => event.type === 'convert' || event.type === 'transform')) return 390;
  if (events.some((event) => event.type === 'shoot' || event.type === 'intercept')) return 330;
  return 260;
}

export function projectHex(hex: Hex, orientation: number, depth: number): { x: number; y: number } {
  const point = hexToWorld(hex);
  const cosine = Math.cos(orientation);
  const sine = Math.sin(orientation);
  return {
    x: cosine * point.x - sine * point.y,
    y: (sine * point.x + cosine * point.y) * boardTilt(depth),
  };
}

export function boardTilt(depth: number): number {
  return 1 + (DEPTH_BOARD_TILT - 1) * depth;
}

export function boardDepthVector(
  orientation: number,
  screenDepth: number,
  tilt: number,
): { x: number; y: number } {
  const depth = screenDepth / tilt;
  return {
    x: Math.sin(orientation) * depth,
    y: Math.cos(orientation) * depth,
  };
}

export function pieceAccessibleLabel(
  state: GameState,
  piece: Piece,
  viewpoint: Player = state.activePlayer,
): string {
  const owner = piece.owner === 0 ? 'Cian' : 'Ámbar';
  const position = `${signed(piece.position.q)}, ${signed(piece.position.r)}`;
  const layer = isAirPiece(piece) ? 'aire' : 'suelo';
  const details =
    piece.type === 'soldier'
      ? `, orientado ${directionNameForPlayer(piece.facing, viewpoint)}`
      : piece.type === 'airplane'
        ? `, orientado ${directionNameForPlayer(piece.facing, viewpoint)}`
        : piece.type === 'medium'
          ? `, cañón ${directionNameForPlayer(piece.cannon, viewpoint)}`
          : piece.type === 'fortress'
            ? `, ${piece.hp} puntos de vida`
            : piece.type === 'long'
              ? `, ${piece.missilesRemaining ?? 2} de 2 misiles disponibles`
              : '';
  const protectedByEnemy = isProtectedByPlayer(state, piece.position, otherPlayerOf(piece.owner))
    ? ', en zona antiaérea enemiga'
    : '';
  return `${PIECE_SHORT_NAMES[piece.type]}, ${owner}, ${layer}, coordenadas ${position}${details}${protectedByEnemy}`;
}

function directionNameForPlayer(direction: Direction, player: Player): string {
  return DIRECTION_NAMES[((direction + (player === 0 ? 3 : 0)) % 6) as Direction];
}

export function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

export function actionsAtHex(state: GameState, actions: GameAction[], hex: Hex): GameAction[] {
  return actions.filter((action) => {
    const destination = actionDestination(state, action);
    return destination ? equalHex(destination, hex) : false;
  });
}

export const BOARD_NOMINAL_SIZE = { width: HEX_WIDTH * 9, height: HEX_HEIGHT * 11 };
