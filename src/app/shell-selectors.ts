import type { Hex, Player } from '../types';
import type { GameSnapshot } from './contracts';

export function fortressMaximumHp(snapshot: GameSnapshot, player: Player): 1 | 2 | 3 {
  const configured = snapshot.matchConfig?.setup.find(
    ({ piece }) => piece.type === 'fortress' && piece.owner === player,
  )?.piece;
  return configured?.type === 'fortress' ? configured.hp : 2;
}

export function accessibleCellId(hex: Hex): string {
  return `hex-cell-${hex.q + 5}-${hex.r + 5}`;
}
