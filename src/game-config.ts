import { allBoardHexes, hexKey } from './hex';
import {
  CLASSIC_NO_PROGRESS_LIMIT,
  CLASSIC_REPETITION_LIMIT,
  CLASSIC_RULESET_ID,
} from './classic-rules';
import { createInitialPieces, type InitialLayout } from './setup';
import type {
  AiDifficulty,
  AiPersonality,
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
  personality?: AiPersonality;
  seed?: number;
  confirmation?: ConfirmationMode;
  contextualHints?: boolean;
  fixedBoard?: boolean;
  handoffScreen?: boolean;
  clockSeconds?: number | null;
  noProgressPlyLimit?: number | null;
  playerNames?: [string, string];
  fortressHp?: FortressHp;
  initialLayout?: InitialLayout;
}

export function createClassicConfig(input: MatchConfigInput): MatchConfig {
  const names = input.playerNames ?? ['Comando Cian', 'Comando Ámbar'];
  const participants: [Participant, Participant] = [
    { kind: 'human', name: names[0] },
    input.mode === 'machine'
      ? {
          kind: 'machine',
          name: 'Mando automático',
          difficulty: input.difficulty ?? 'recruit',
          personality: input.personality ?? 'balanced',
          ...(input.seed === undefined ? {} : { seed: input.seed }),
        }
      : { kind: 'human', name: names[1] },
  ];
  const options: MatchOptions = {
    confirmation: input.confirmation ?? 'always',
    contextualHints: input.contextualHints ?? true,
    fixedBoard: input.fixedBoard ?? true,
    handoffScreen: input.handoffScreen ?? false,
    clockSeconds: input.clockSeconds ?? null,
    noProgressPlyLimit:
      input.noProgressPlyLimit === undefined ? CLASSIC_NO_PROGRESS_LIMIT : input.noProgressPlyLimit,
    allowUndo: true,
  };
  const pieces = createInitialPieces(input.fortressHp ?? 2, input.initialLayout ?? 1);
  return {
    definitionId: 'classic',
    rulesetId: CLASSIC_RULESET_ID,
    participants,
    board: { kind: 'hex-set', cells: allBoardHexes() },
    setup: pieces.map((piece) => ({ id: piece.id, piece })),
    victory: {
      kind: 'classic-fortress',
      repetition: CLASSIC_REPETITION_LIMIT,
      blockade: true,
    },
    options,
  };
}

export function validateMatchConfig(config: MatchConfig): string[] {
  const errors: string[] = [];
  if (config.rulesetId !== CLASSIC_RULESET_ID) errors.push('Ruleset no compatible.');
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
  if (
    config.options.clockSeconds !== null &&
    (!Number.isFinite(config.options.clockSeconds) ||
      config.options.clockSeconds <= 0 ||
      !Number.isSafeInteger(Math.round(config.options.clockSeconds * 1_000)))
  )
    errors.push('El reloj debe ser positivo.');
  if (
    config.options.noProgressPlyLimit !== undefined &&
    config.options.noProgressPlyLimit !== null &&
    (!Number.isInteger(config.options.noProgressPlyLimit) || config.options.noProgressPlyLimit <= 0)
  )
    errors.push('El límite de órdenes sin progreso debe ser un entero positivo.');
  if (
    !Number.isInteger(config.victory.repetition) ||
    config.victory.repetition < 0 ||
    config.victory.repetition === 1
  )
    errors.push('El umbral de repetición debe ser 0 (desactivado) o al menos 2.');
  for (const participant of config.participants) {
    if (
      participant.seed !== undefined &&
      (!Number.isSafeInteger(participant.seed) || participant.seed < 0)
    )
      errors.push('La semilla de la IA debe ser un entero seguro no negativo.');
  }
  return errors;
}

export function assertValidMatchConfig(config: MatchConfig): void {
  const errors = validateMatchConfig(config);
  if (errors.length) throw new Error(`Configuración inválida: ${errors.join(' ')}`);
}
