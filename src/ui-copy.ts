import type { PieceType } from './types';

export function captureAboveCommandLabel(targetType: PieceType): string {
  if (targetType !== 'drone' && targetType !== 'airplane') {
    throw new Error('La captura superior solo admite unidades aéreas.');
  }
  return 'Capturar aeronave superior';
}
