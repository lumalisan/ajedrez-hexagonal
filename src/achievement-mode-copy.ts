import type { ProgressionMode } from './progression';

export function achievementModeDescription(
  modes: readonly ProgressionMode[],
  minDifficulty: number,
  metric?: string,
): string {
  if (!modes.length) return '';
  const difficulty = ['', 'nivel medio o superior', 'nivel difícil o experto', 'nivel experto'][
    minDifficulty
  ];
  if (modes.length === 1) {
    if (modes[0] === 'machine') {
      return `Solo partidas contra Hexfortia${difficulty ? ` en ${difficulty}` : ''}.`;
    }
    return modes[0] === 'online' ? 'Solo en partidas en línea.' : 'Solo en partidas locales.';
  }
  if (modes.length === 3 && minDifficulty === 0) {
    return metric === 'matches' || metric === 'year2488'
      ? 'Cualquier modo de juego es válido.'
      : 'Cualquier modo de juego es válido. En las partidas locales, solo cuentan las acciones del jugador local.';
  }
  const labels = [
    modes.includes('machine') ? `contra Hexfortia${difficulty ? ` (${difficulty})` : ''}` : '',
    modes.includes('online') ? 'en línea' : '',
    modes.includes('local') ? 'locales' : '',
  ].filter(Boolean);
  const alternatives = `${labels.slice(0, -1).join(', ')} o ${labels.at(-1)}`;
  return modes.includes('local')
    ? `En partidas ${alternatives}. En las partidas locales, solo cuentan las acciones del jugador local.`
    : `Solo en partidas ${alternatives}.`;
}
