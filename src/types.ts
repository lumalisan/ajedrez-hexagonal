export type Player = 0 | 1;

export type Direction = 0 | 1 | 2 | 3 | 4 | 5;

export interface Hex {
  readonly q: number;
  readonly r: number;
}

export type PieceType =
  | 'soldier'
  | 'capturer'
  | 'medium'
  | 'long'
  | 'fast'
  | 'drone'
  | 'airplane'
  | 'antiAir'
  | 'fortress';

interface BasePiece {
  id: string;
  owner: Player;
  position: Hex;
}

export type Piece =
  | (BasePiece & { type: 'soldier'; facing: Direction })
  | (BasePiece & { type: 'capturer' })
  | (BasePiece & { type: 'medium'; cannon: Direction })
  | (BasePiece & { type: 'long' })
  | (BasePiece & { type: 'fast' })
  | (BasePiece & { type: 'drone' })
  | (BasePiece & { type: 'airplane'; facing: Direction })
  | (BasePiece & { type: 'antiAir' })
  | (BasePiece & { type: 'fortress'; hp: 1 | 2 });

export interface CellOccupancy {
  ground?: Piece;
  air?: Piece;
}

export type GameAction =
  | { kind: 'move'; pieceId: string; to: Hex; cannon?: Direction; kamikaze?: boolean }
  | { kind: 'rotate'; pieceId: string; facing: Direction }
  | { kind: 'orient'; pieceId: string; cannon: Direction }
  | { kind: 'shoot'; pieceId: string; targetId: string }
  | { kind: 'convert'; pieceId: string; targetId: string }
  | { kind: 'attackAbove'; pieceId: string; targetId: string }
  | { kind: 'attackBelow'; pieceId: string; targetId: string }
  | {
      kind: 'transform';
      pieceId: string;
      facing: Direction;
      to?: Hex;
      attackAboveId?: string;
    };

export type GameEventType =
  | 'move'
  | 'destroy'
  | 'shoot'
  | 'convert'
  | 'rotate'
  | 'transform'
  | 'intercept'
  | 'fortressDamage'
  | 'pass'
  | 'victory'
  | 'draw';

export interface GameEvent {
  type: GameEventType;
  pieceId?: string;
  targetId?: string;
  owner?: Player;
  from?: Hex;
  to?: Hex;
  at?: Hex;
  amount?: number;
}

export type Outcome =
  | { type: 'win'; winner: Player; reason: 'fortress' | 'blockade' | 'repetition' }
  | { type: 'draw'; reason: 'blockade' | 'repetition' };

export interface BattleLogEntry {
  id: number;
  player: Player;
  text: string;
}

export interface GameState {
  pieces: Piece[];
  activePlayer: Player;
  ply: number;
  firstFortressDamageBy: Player | null;
  positionCounts: Record<string, number>;
  outcome: Outcome | null;
  history: BattleLogEntry[];
}

export interface ActionResult {
  ok: boolean;
  state: GameState;
  events: GameEvent[];
  error?: string;
}

export interface PlayerInfo {
  name: string;
  shortName: string;
}

export interface GamePreferences {
  sound: boolean;
  masterVolume: number;
  musicVolume: number;
  effectsVolume: number;
  fixedBoard: boolean;
  boardDepth: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  confirmation: ConfirmationMode;
  contextualHints: boolean;
  handoffScreen: boolean;
}

export type ConfirmationMode = 'always' | 'critical' | 'quick';

export type GameMode = 'local' | 'machine' | 'academy';

export type AiDifficulty = 'recruit' | 'tactical' | 'commander';

export interface Participant {
  kind: 'human' | 'machine';
  name: string;
  difficulty?: AiDifficulty;
}

export interface BoardDefinition {
  kind: 'hex-set';
  cells: Hex[];
}

export interface PieceSetup {
  id: string;
  piece: Piece;
}

export interface VictoryDefinition {
  kind: 'classic-fortress';
  repetition: number;
  blockade: boolean;
}

export interface MatchOptions {
  confirmation: ConfirmationMode;
  contextualHints: boolean;
  fixedBoard: boolean;
  handoffScreen: boolean;
  clockSeconds: number | null;
  allowUndo: boolean;
}

export interface MatchConfig {
  definitionId: string;
  rulesetId: 'classic-v1';
  participants: [Participant, Participant];
  board: BoardDefinition;
  setup: PieceSetup[];
  victory: VictoryDefinition;
  options: MatchOptions;
}

export interface MatchRecord {
  version: 1;
  config: MatchConfig;
  initialState: GameState;
  actions: GameAction[];
  currentAction: number;
  createdAt: string;
  updatedAt: string;
}

export type ScenarioObjective =
  | { kind: 'perform-action'; actionKind: GameAction['kind']; pieceId?: string }
  | { kind: 'capture'; targetId: string }
  | { kind: 'damage-fortress'; owner: Player }
  | { kind: 'win' };

export interface ScenarioDefinition {
  id: string;
  title: string;
  summary: string;
  controlledPlayer: Player;
  initialState: GameState;
  objective: ScenarioObjective;
  maxPlies?: number;
  hints: string[];
  successText: string;
}

export interface MatchStatistics {
  plies: number;
  captures: [number, number];
  fortressDamage: [number, number];
  transformations: [number, number];
  startedAt: string;
  updatedAt: string;
}
