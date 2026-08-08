import { hexKey } from './hex';
import type { GameAction } from './types';

/** Stable domain identity for an order, independent of object property order. */
export function actionKey(action: GameAction): string {
  switch (action.kind) {
    case 'move':
      return `move:${action.pieceId}:${hexKey(action.to)}:${action.cannon ?? '-'}:${action.kamikaze ? 'k' : '-'}`;
    case 'rotate':
      return `rotate:${action.pieceId}:${action.facing}`;
    case 'orient':
      return `orient:${action.pieceId}:${action.cannon}`;
    case 'shoot':
    case 'convert':
    case 'attackAbove':
    case 'attackBelow':
      return `${action.kind}:${action.pieceId}:${action.targetId}`;
    case 'transform':
      return `transform:${action.pieceId}:${action.facing}:${action.to ? hexKey(action.to) : '-'}:${action.attackAboveId ?? '-'}`;
  }
}

export function sameAction(left: GameAction, right: GameAction): boolean {
  return actionKey(left) === actionKey(right);
}
