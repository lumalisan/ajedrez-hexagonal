import type { SearchMetadata } from '../ai';
import type { UiMode } from '../match-store';
import type { BoardRenderer } from '../renderer';
import type { ScenarioProgress } from '../scenarios';
import type {
  GameAction,
  GameEvent,
  GameMode,
  GamePreferences,
  GameState,
  Hex,
  MatchConfig,
  MatchRecord,
  ScenarioDefinition,
} from '../types';

export type DialogState =
  | { kind: 'config'; mode: 'local' | 'machine' }
  | { kind: 'academy' }
  | { kind: 'rules'; sectionId?: string }
  | { kind: 'settings' }
  | { kind: 'history' }
  | { kind: 'abandon' }
  | { kind: 'mode'; initial?: boolean }
  | { kind: 'resign' }
  | { kind: 'draw-offer' }
  | { kind: 'blockade' }
  | { kind: 'outcome' }
  | { kind: 'scenario-briefing'; scenario: ScenarioDefinition }
  | { kind: 'scenario-success'; scenario: ScenarioDefinition }
  | { kind: 'scenario-retry'; scenario: ScenarioDefinition; feedback: string }
  | { kind: 'handoff' };

export interface GameSnapshot {
  state: GameState;
  preferences: GamePreferences;
  selectedId: string | null;
  pendingAction: GameAction | null;
  mode: UiMode;
  hoveredHex: Hex | null;
  focusedHex: Hex | null;
  visibleActions: GameAction[];
  firingRange: Hex[];
  lastEvents: GameEvent[];
  animating: boolean;
  gameMode: GameMode | null;
  matchConfig: MatchConfig | null;
  matchRecord: MatchRecord | null;
  activeScenario: ScenarioDefinition | null;
  scenarioProgress: ScenarioProgress | null;
  scenarioHintsRevealed: number;
  machineThinking: boolean;
  machineSearch: SearchMetadata | null;
  isMachineTurn: boolean;
  viewPlayer: 0 | 1;
  isLocalMatch: boolean;
  canUndo: boolean;
  canRedo: boolean;
  logOpen: boolean;
  homeView: 'main' | 'new' | null;
  dialog: DialogState | null;
  dialogError: string | null;
  replayCursor: number | null;
  announcement: string;
  announcementId: number;
  toasts: Array<{ id: number; message: string }>;
}

export interface GameCommands {
  openDialog(dialog: DialogState): void;
  closeDialog(): void;
  showHome(view?: 'main' | 'new'): void;
  setHomeView(view: 'main' | 'new'): void;
  abandon(): void;
  startMatch(config: MatchConfig): void;
  startScenario(scenario: ScenarioDefinition): void;
  continueMatch(): void;
  resetGame(): void;
  loadRecord(record: MatchRecord): void;
  importMatch(file: File): Promise<void>;
  exportMatch(): void;
  updatePreferences(preferences: Partial<GamePreferences>): void;
  toggleSound(): void;
  selectPiece(pieceId: string): void;
  selectHex(hex: Hex): void;
  clearSelection(): void;
  cancelDraft(): void;
  prepareAction(action: GameAction): void;
  commitPending(): Promise<void>;
  setMode(mode: UiMode): void;
  hoverHex(hex: Hex | null): void;
  focusHex(hex: Hex): void;
  announceCell(hex: Hex): void;
  announce(message: string): void;
  showToast(message: string): void;
  setLogOpen(open: boolean): void;
  undo(): void;
  redo(): void;
  openReplay(initialAction?: number): void;
  setReplayCursor(cursor: number): void;
  closeReplay(): void;
  resign(): void;
  acceptBlockade(): Promise<void>;
  revealHint(scenario: ScenarioDefinition): void;
  readyForTurn(): void;
  zoomBy(factor: number, clientX?: number, clientY?: number): void;
  resetView(): void;
}

export interface GameSession {
  getSnapshot(): GameSnapshot;
  subscribe(listener: () => void): () => void;
  commands: GameCommands;
  attachRenderer(renderer: GameRenderer): () => void;
  start(): () => void;
  dispose(): void;
}

export type GameRenderer = Pick<
  BoardRenderer,
  | 'setDepthMode'
  | 'snapToPlayer'
  | 'setModel'
  | 'resetView'
  | 'zoomBy'
  | 'playEvents'
  | 'rotateToPlayer'
>;
