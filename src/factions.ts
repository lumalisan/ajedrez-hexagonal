import type { Participant, Player } from './types';
export const FACTIONS = {
  expansionist: { name: 'Expansionista', color: '#36b9ff' },
  conservationist: { name: 'Conservacionista', color: '#b8a1ff' },
} as const;
export function participantLabel(participant: Participant | undefined, fallback: string): string {
  if (!participant) return fallback;
  return participant.faction && participant.kind === 'human'
    ? participant.name + ' · ' + FACTIONS[participant.faction].name
    : participant.name;
}
export function participantColor(participant: Participant | undefined, player: Player): string {
  return participant?.faction
    ? FACTIONS[participant.faction].color
    : player === 0
      ? '#36b9ff'
      : '#ffb547';
}
