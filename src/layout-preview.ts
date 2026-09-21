import { createGameState } from './engine';
import { allBoardHexes } from './hex';
import { BoardRenderer } from './renderer';
import { INITIAL_LAYOUTS, createInitialPieces, type InitialLayout } from './setup';
import type { FortressHp } from './types';

export interface LayoutPreviewOptions {
  initialLayout: InitialLayout;
  fortressHp: FortressHp;
  highContrast: boolean;
  /** Show both armies and all 91 cells instead of Cian's close-up. */
  fullBoard?: boolean;
}

export interface LayoutPreview {
  update(options: LayoutPreviewOptions): void;
  destroy(): void;
}

// All layouts share a camera frame so their positions can be compared without zoom changes.
const PREVIEW_POSITIONS = INITIAL_LAYOUTS.flatMap(({ id }) =>
  createInitialPieces(2, id)
    .filter((piece) => piece.owner === 0)
    .map((piece) => piece.position),
);
const FULL_BOARD_POSITIONS = allBoardHexes();

/** A static deployment preview, viewed from Cian's side. */
export function mountLayoutPreview(
  canvas: HTMLCanvasElement,
  options: LayoutPreviewOptions,
): LayoutPreview {
  const renderer = new BoardRenderer(canvas);
  renderer.snapToPlayer(0);
  renderer.setDepthMode(false, true);

  function update(next: LayoutPreviewOptions): void {
    const state = createGameState(createInitialPieces(next.fortressHp, next.initialLayout));
    const pieces = next.fullBoard
      ? state.pieces
      : state.pieces.filter((piece) => piece.owner === 0);
    renderer.setFrame(next.fullBoard ? FULL_BOARD_POSITIONS : PREVIEW_POSITIONS);

    renderer.setModel({
      state: { ...state, pieces },
      fortressMaxHp: [next.fortressHp, next.fortressHp],
      selectedId: null,
      actions: [],
      pending: null,
      hovered: null,
      focused: null,
      firingRange: [],
      lastEvents: [],
      threatenedCells: [],
      reducedMotion: true,
      highContrast: next.highContrast,
    });
  }

  update(options);
  return { update, destroy: () => renderer.destroy() };
}
