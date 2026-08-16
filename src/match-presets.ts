import { createClassicConfig, type MatchConfigInput } from './game-config';
import { stepHex } from './hex';
import type { MatchConfig, Piece } from './types';

export type MatchPresetId = 'skirmish' | 'tactical' | 'siege' | 'custom';

export interface MatchPresetDefinition {
  id: MatchPresetId;
  name: string;
  duration: string;
  description: string;
  fortressHp: 1 | 2 | 3;
}

export const MATCH_PRESETS: MatchPresetDefinition[] = [
  {
    id: 'skirmish',
    name: 'Escaramuza',
    duration: '10–15 min',
    description: 'Fuerzas reducidas, contacto temprano y decisiones inmediatas.',
    fortressHp: 1,
  },
  {
    id: 'tactical',
    name: 'Táctica',
    duration: '25–40 min',
    description: 'Ejércitos completos y dos puntos de integridad. La experiencia recomendada.',
    fortressHp: 2,
  },
  {
    id: 'siege',
    name: 'Asedio',
    duration: '40–60 min',
    description: 'Tres puntos de integridad y más margen para planes profundos.',
    fortressHp: 3,
  },
  {
    id: 'custom',
    name: 'Personalizada',
    duration: 'Variable',
    description: 'Control manual de integridad, despliegue y reloj.',
    fortressHp: 2,
  },
];

export function createPresetConfig(preset: MatchPresetId, input: MatchConfigInput): MatchConfig {
  const definition = MATCH_PRESETS.find((candidate) => candidate.id === preset) ?? MATCH_PRESETS[1];
  const config = createClassicConfig({
    ...input,
    fortressHp: preset === 'custom' ? input.fortressHp : definition.fortressHp,
    initialLayout: preset === 'siege' ? 2 : input.initialLayout,
    clockSeconds:
      preset === 'skirmish' && input.clockSeconds === undefined
        ? 600
        : (input.clockSeconds ?? null),
  });
  const setup =
    preset === 'skirmish'
      ? skirmishPieces(config.setup.map(({ piece }) => piece)).map((piece) => ({
          id: piece.id,
          piece,
        }))
      : config.setup;
  return {
    ...config,
    definitionId: preset === 'custom' ? 'classic' : preset,
    setup,
    options: {
      ...config.options,
      noProgressPlyLimit: preset === 'skirmish' ? 60 : preset === 'siege' ? 160 : 120,
    },
  };
}

function skirmishPieces(pieces: Piece[]): Piece[] {
  const selectedByOwner = new Map<number, Set<string>>();
  for (const owner of [0, 1] as const) {
    const own = pieces.filter((piece) => piece.owner === owner);
    const pick = (type: Piece['type'], count: number): Piece[] =>
      own.filter((piece) => piece.type === type).slice(-count);
    selectedByOwner.set(
      owner,
      new Set(
        [
          ...pick('fortress', 1),
          ...pick('antiAir', 1),
          ...pick('soldier', 3),
          ...pick('medium', 1),
          ...pick('capturer', 1),
          ...pick('drone', 1),
          ...pick('airplane', 1),
        ].map((piece) => piece.id),
      ),
    );
  }

  return pieces
    .filter((piece) => selectedByOwner.get(piece.owner)?.has(piece.id))
    .map((piece) => {
      if (piece.type === 'fortress' || piece.type === 'antiAir') return piece;
      const position = stepHex(piece.position, piece.owner === 0 ? 3 : 0);
      return { ...piece, position } as Piece;
    });
}
