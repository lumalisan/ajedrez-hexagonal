import { MATCH_INITIAL_LAYOUTS, type InitialLayout } from './setup';
import type { FortressHp, Participant } from './types';

export type Faction = NonNullable<Participant['faction']>;
export type MatchClockValue = '' | 300 | 600 | 1200;
export type TurnClockValue = '' | 30 | 60 | 90;

export const FACTION_OPTIONS: readonly { value: Faction; label: string }[] = [
  { value: 'expansionist', label: 'Expansionista · Azul cian' },
  { value: 'conservationist', label: 'Conservacionista · Verde esmeralda' },
];
export const FORTRESS_HP_OPTIONS: readonly { value: FortressHp; label: string }[] = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
];
export const INITIAL_LAYOUT_OPTIONS: readonly { value: InitialLayout; label: string }[] =
  MATCH_INITIAL_LAYOUTS.map(({ id, name }) => ({ value: id, label: name }));
export const MATCH_CLOCK_OPTIONS: readonly { value: MatchClockValue; label: string }[] = [
  { value: '', label: 'Sin límite' },
  { value: 300, label: '5 minutos' },
  { value: 600, label: '10 minutos' },
  { value: 1200, label: '20 minutos' },
];
export const TURN_CLOCK_OPTIONS: readonly { value: TurnClockValue; label: string }[] = [
  { value: '', label: 'Sin límite' },
  { value: 30, label: '30 segundos' },
  { value: 60, label: '60 segundos' },
  { value: 90, label: '90 segundos' },
];
