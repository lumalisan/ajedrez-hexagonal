import { createGameState } from './engine';
import { BoardRenderer } from './renderer';
import { createInitialPieces, type InitialLayout } from './setup';
import type { FortressHp } from './types';

export interface LayoutPreviewOptions {
  initialLayout: InitialLayout;
  fortressHp: FortressHp;
  highContrast: boolean;
}

export interface LayoutPreview {
  update(options: LayoutPreviewOptions): void;
  destroy(): void;
}

/** A static close-up of the selected deployment, viewed from Cian's side. */
export function mountLayoutPreview(
  canvas: HTMLCanvasElement,
  options: LayoutPreviewOptions,
): LayoutPreview {
  const renderer = new BoardRenderer(canvas);
  renderer.snapToPlayer(0);
  renderer.setDepthMode(false, true);

  function update(next: LayoutPreviewOptions): void {
    const state = createGameState(createInitialPieces(next.fortressHp, next.initialLayout));
    const pieces = state.pieces.filter((piece) => piece.owner === 0);

    renderer.setFrame(pieces.map((piece) => piece.position));
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
