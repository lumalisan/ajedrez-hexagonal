import type { ProgressionMode } from './progression';

export function achievementModeDescription(
  modes: readonly ProgressionMode[],
  minDifficulty: number,
): string {
  if (!modes.length) return '';
  const difficulty = ['', 'nivel medio o superior', 'nivel difícil o experto', 'nivel experto'][
    minDifficulty
  ];
  if (modes.length === 1) {
    if (modes[0] === 'machine') {
      return `Solo en partidas contra Hexfortia${difficulty ? ` en ${difficulty}` : ''}.`;
    }
    return modes[0] === 'online'
      ? 'Solo en partidas en línea contra otros jugadores.'
      : 'Solo en partidas locales. Únicamente cuentan las acciones del jugador local, no las del invitado.';
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
