import { allBoardHexes, hexKey } from './hex';
import { createInitialPieces, type InitialLayout } from './setup';
import type {
  AiDifficulty,
  ConfirmationMode,
  FortressHp,
  GameMode,
  MatchConfig,
  MatchOptions,
  Participant,
} from './types';

export interface MatchConfigInput {
  mode: Exclude<GameMode, 'academy'>;
  difficulty?: AiDifficulty;
  confirmation?: ConfirmationMode;
  contextualHints?: boolean;
  fixedBoard?: boolean;
  handoffScreen?: boolean;
  clockSeconds?: number | null;
  playerNames?: [string, string];
  fortressHp?: FortressHp;
  initialLayout?: InitialLayout;
}

export function createClassicConfig(input: MatchConfigInput): MatchConfig {
  const names = input.playerNames ?? ['Comando Cian', 'Comando Ámbar'];
  const participants: [Participant, Participant] = [
    { kind: 'human', name: names[0] },
    input.mode === 'machine'
      ? { kind: 'machine', name: 'Mando automático', difficulty: input.difficulty ?? 'recruit' }
      : { kind: 'human', name: names[1] },
  ];
  const options: MatchOptions = {
    confirmation: input.confirmation ?? 'always',
    contextualHints: input.contextualHints ?? true,
    fixedBoard: input.fixedBoard ?? true,
    handoffScreen: input.handoffScreen ?? false,
    clockSeconds: input.clockSeconds ?? null,
    allowUndo: input.mode === 'machine',
  };
  const pieces = createInitialPieces(input.fortressHp ?? 2, input.initialLayout ?? 1);
  return {
    definitionId: 'classic',
    rulesetId: 'classic-v2',
    participants,
    board: { kind: 'hex-set', cells: allBoardHexes() },
    setup: pieces.map((piece) => ({ id: piece.id, piece })),
    victory: { kind: 'classic-fortress', repetition: 0, blockade: true },
    options,
  };
}

export function validateMatchConfig(config: MatchConfig): string[] {
  const errors: string[] = [];
  if (config.rulesetId !== 'classic-v2') errors.push('Ruleset no compatible.');
  if (!config.definitionId.trim()) errors.push('La definición no tiene identificador.');
  if (config.participants.length !== 2) errors.push('La partida necesita dos participantes.');
  const cells = new Set(config.board.cells.map(hexKey));
  if (cells.size !== config.board.cells.length)
    errors.push('El tablero contiene casillas duplicadas.');
  const ids = new Set<string>();
  for (const setup of config.setup) {
    if (setup.id !== setup.piece.id) errors.push(`Identificador inconsistente: ${setup.id}.`);
    if (ids.has(setup.id)) errors.push(`Pieza duplicada: ${setup.id}.`);
    ids.add(setup.id);
    if (!cells.has(hexKey(setup.piece.position)))
      errors.push(`La pieza ${setup.id} está fuera del tablero configurado.`);
    if (setup.piece.type === 'fortress' && ![1, 2, 3].includes(setup.piece.hp))
      errors.push(`La Fortaleza ${setup.id} tiene puntos de vida inválidos.`);
  }
  for (const player of [0, 1] as const) {
    const fortresses = config.setup.filter(
      ({ piece }) => piece.owner === player && piece.type === 'fortress',
    );
    if (fortresses.length !== 1)
      errors.push(`El jugador ${player} debe tener exactamente una Fortaleza.`);
  }
  if (config.options.clockSeconds !== null && config.options.clockSeconds <= 0)
    errors.push('El reloj debe ser positivo.');
  return errors;
}

export function assertValidMatchConfig(config: MatchConfig): void {
  const errors = validateMatchConfig(config);
  if (errors.length) throw new Error(`Configuración inválida: ${errors.join(' ')}`);
}
