import type { Piece, PieceType } from './types';

export function selectedUnitInstruction(piece: Piece): string {
  switch (piece.type) {
    case 'fortress':
      return 'Fortaleza seleccionada. La fortaleza no puede realizar ninguna acción.';
    case 'antiAir':
      return 'Escudo antiaéreo seleccionado. El escudo antiaéreo no puede realizar ninguna acción.';
    case 'soldier':
      return 'Asaltador seleccionado. Elige una casilla para desplazarte o atacar, o cambia su orientación.';
    case 'capturer':
      return 'Capturador seleccionado. Elige una casilla para desplazarte o capturar.';
    case 'medium':
      return 'Tanque seleccionado. Elige una casilla para desplazarte o disparar, cambia la orientación del cañón o conviértelo en asaltador.';
    case 'long':
      return (piece.missilesRemaining ?? 2) === 0
        ? 'Lanzamisiles seleccionado. Elige una casilla para desplazarte o conviértelo en asaltador.'
        : 'Lanzamisiles seleccionado. Elige una casilla para desplazarte o disparar, o conviértelo en asaltador.';
    case 'fast':
      return 'Embestidor seleccionado. Elige una casilla para desplazarte o atacar, o conviértelo en asaltador.';
    case 'drone':
      return 'Dron seleccionado. Elige una casilla para desplazarte o atacar.';
    case 'airplane':
      return 'Caza seleccionado. Elige una casilla para desplazarte, disparar o realizar un ataque kamikaze.';
  }
}

export function captureAboveCommandLabel(targetType: PieceType): string {
  if (targetType !== 'drone' && targetType !== 'airplane') {
    throw new Error('La captura superior solo admite unidades aéreas.');
  }
  return 'Capturar aeronave superior';
}
