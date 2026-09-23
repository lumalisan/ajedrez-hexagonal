export type Player = 0 | 1;

export type Direction = 0 | 1 | 2 | 3 | 4 | 5;

export type FortressHp = 1 | 2 | 3;

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
  | (BasePiece & { type: 'long'; missilesRemaining?: 0 | 1 | 2 })
  | (BasePiece & { type: 'fast' })
  | (BasePiece & { type: 'drone' })
  | (BasePiece & { type: 'airplane'; facing: Direction })
  | (BasePiece & { type: 'antiAir' })
  | (BasePiece & { type: 'fortress'; hp: FortressHp });

export interface CellOccupancy {
  ground?: Piece;
  air?: Piece;
}

export type GameAction =
  | {
      kind: 'move';
      pieceId: string;
      to: Hex;
      cannon?: Direction;
      kamikaze?: boolean;
      targetId?: string;
    }
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
  | { type: 'win'; winner: Player; reason: 'fortress' | 'resignation' | 'timeout' }
  | { type: 'draw'; reason: 'blockade' | 'repetition' | 'no-progress' };

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
  /**
   * Consecutive plies without a capture, interception, or Fortress damage.
   * Optional so version 2 saves created before the no-progress rule still load.
   */
  noProgressPlyCount?: number;
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
  idleAnimations: boolean;
  highContrast: boolean;
  confirmation: ConfirmationMode;
  contextualHints: boolean;
  tacticalThreats: boolean;
  handoffScreen: boolean;
}

export type ConfirmationMode = 'always' | 'critical' | 'quick';

export type GameMode = 'local' | 'machine' | 'academy';

export type AiDifficulty = 'recruit' | 'tactical' | 'commander' | 'expert';

export type AiPersonality = 'balanced' | 'aggressive' | 'guardian' | 'ambush';

export interface Participant {
  kind: 'human' | 'machine';
  name: string;
  difficulty?: AiDifficulty;
  personality?: AiPersonality;
  seed?: number;
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
  /** Null or absent disables the independent per-turn countdown. */
  turnClockSeconds?: number | null;
  /** Null disables the automatic draw. Defaults to 120 in classic games. */
  noProgressPlyLimit?: number | null;
  allowUndo: boolean;
}

export interface MatchConfig {
  definitionId: string;
  rulesetId: 'classic-v2';
  participants: [Participant, Participant];
  board: BoardDefinition;
  setup: PieceSetup[];
  victory: VictoryDefinition;
  options: MatchOptions;
}

export type MatchClockStatus = 'paused' | 'running' | 'turn-expired' | 'timeout';

/** Serializable state for a deterministic two-player countdown clock. */
export interface MatchClockSnapshot {
  /** Null disables total time; remainingMs is then [0, 0]. */
  initialMs: number | null;
  remainingMs: [number, number];
  /** Optional for compatibility with existing version 2 saves. */
  turnInitialMs?: number | null;
  turnRemainingMs?: number | null;
  /** Per-player expired turns; absent in legacy version 2 saves means zero. */
  turnTimeouts?: [number, number];
  activePlayer: Player;
  status: MatchClockStatus;
  lastTickAt: number | null;
  timedOutPlayer: Player | null;
}

/** A terminal result that was not encoded as a board action. */
export interface MatchConclusion {
  outcome: Outcome;
  atAction: number;
  recordedAt: string;
}

/** Portable Academy UI state that belongs to this replay, not to local progress. */
export interface AcademySessionMetadata {
  scenarioId: string;
  hintsRevealed: number;
}

export interface MatchRecord {
  version: 2;
  config: MatchConfig;
  initialState: GameState;
  actions: GameAction[];
  currentAction: number;
  /** Optional for compatibility with existing version 2 saves. */
  conclusion?: MatchConclusion | null;
  /** Optional for compatibility with existing version 2 saves. */
  clock?: MatchClockSnapshot | null;
  /** Optional for compatibility with existing version 2 saves and non-Academy matches. */
  academySession?: AcademySessionMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export type ScenarioObjective =
  | { kind: 'perform-action'; actionKind: GameAction['kind']; pieceId?: string }
  | { kind: 'capture'; targetId: string }
  | { kind: 'damage-fortress'; owner: Player }
  | { kind: 'win' }
  | { kind: 'win-in'; maxPlies: number }
  | { kind: 'survive'; plies: number; owner?: Player }
  | { kind: 'protect-piece'; pieceId: string; plies: number }
  | { kind: 'reach'; pieceId: string; target: Hex };

export interface ScenarioStage {
  atPly: number;
  text: string;
}

export interface ScenarioDefinition {
  id: string;
  title: string;
  summary: string;
  controlledPlayer: Player;
  initialState: GameState;
  objective: ScenarioObjective;
  maxPlies?: number;
  category?: 'basic' | 'guided' | 'strategic' | 'daily';
  difficulty?: 1 | 2 | 3;
  lesson?: string;
  stages?: ScenarioStage[];
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
