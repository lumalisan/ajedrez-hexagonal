import type { GameAction, GameEvent, GameState, Hex } from './types';

export type UiMode =
  | { kind: 'default' }
  | { kind: 'rotate' }
  | { kind: 'orient' }
  | { kind: 'transform'; facing: import('./types').Direction | null }
  | { kind: 'actionChoice'; actions: GameAction[] }
  | { kind: 'pieceChoice'; pieceIds: string[] };

export interface MatchUiState {
  selectedPieceId: string | null;
  pendingAction: GameAction | null;
  interactionMode: UiMode;
  focusedHex: Hex | null;
  hoveredHex: Hex | null;
  isAnimating: boolean;
  isOpponentThinking: boolean;
  lastEvents: GameEvent[];
}

export interface MatchViewState {
  game: GameState;
  ui: MatchUiState;
}

type Listener = (state: MatchViewState) => void;

export class MatchStore {
  readonly #listeners = new Set<Listener>();
  #state: MatchViewState;

  constructor(game: GameState) {
    this.#state = {
      game,
      ui: {
        selectedPieceId: null,
        pendingAction: null,
        interactionMode: { kind: 'default' },
        focusedHex: { q: 0, r: 0 },
        hoveredHex: null,
        isAnimating: false,
        isOpponentThinking: false,
        lastEvents: [],
      },
    };
  }

  getState(): MatchViewState {
    return this.#state;
  }

  update(update: (state: MatchViewState) => MatchViewState): void {
    this.#state = update(this.#state);
    for (const listener of this.#listeners) listener(this.#state);
  }

  replaceGame(game: GameState): void {
    this.update((current) => ({
      game,
      ui: {
        ...current.ui,
        selectedPieceId: null,
        pendingAction: null,
        interactionMode: { kind: 'default' },
        lastEvents: [],
      },
    }));
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
