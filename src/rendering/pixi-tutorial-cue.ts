import { Container, Graphics } from 'pixi.js';
import { equalHex, hexToWorld } from '../hex';
import { COLORS, actionMarkers, boardTilt, projectHex, type RenderModel } from './model';
import { hexPoints } from './shapes';
import { placeTutorialArrow, type ArrowObstacle } from './tutorial-arrow';

interface TutorialView {
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
  orientation: number;
  depth: number;
}

/** Retained white cell frame and a short arrow, clear of units and action markers. */
export class PixiTutorialCue {
  readonly board = new Graphics({ label: 'tutorial-cell', eventMode: 'none' });
  readonly screen = new Container({ label: 'tutorial-arrow', eventMode: 'none' });
  private readonly connector = new Graphics();
  private frameKey = '';
  private layoutKey = '';
  constructor() {
    this.screen.addChild(this.connector);
    this.board.visible = false;
    this.screen.visible = false;
  }
  update(model: RenderModel | null, view: TutorialView): void {
    const cue = model?.tutorialCue;
    this.board.visible = Boolean(cue);
    this.screen.visible = Boolean(cue);
    if (!cue || !model) return;
    const color = '#ffffff';
    const dark = model.highContrast ? '#000000' : COLORS.background;
    const frames = cue.outlineHexes ?? [cue.hex];
    const frameKey = JSON.stringify([frames, model.highContrast]);
    if (frameKey !== this.frameKey) {
      this.frameKey = frameKey;
      this.board.clear();
      for (const hex of frames) {
        const world = hexToWorld(hex);
        this.board
          .poly(hexPoints(29, world.x, world.y))
          .stroke({ color: dark, width: 8, join: 'round' })
          .poly(hexPoints(29, world.x, world.y))
          .stroke({ color, width: 3.4, join: 'round' })
          .poly(hexPoints(23.6, world.x, world.y))
          .stroke({ color, width: 1.8, join: 'round' });
      }
    }
    const project = (hex: typeof cue.hex) => {
      const projected = projectHex(hex, view.orientation, view.depth);
      return { x: view.x + projected.x * view.scale, y: view.y + projected.y * view.scale };
    };
    const target = project(cue.hex);
    this.screen.visible =
      target.x >= 0 && target.x <= view.width && target.y >= 0 && target.y <= view.height;
    if (!this.screen.visible) return;
    const obstacles: ArrowObstacle[] = [];
    for (const piece of model.state.pieces) {
      if (equalHex(piece.position, cue.hex)) continue;
      const point = project(piece.position);
      // Account for the raised aerial silhouette in the depth view.
      obstacles.push({
        ...point,
        y:
          point.y -
          (piece.type === 'drone' || piece.type === 'airplane' ? 27 : 4) * view.depth * view.scale,
        radius: 24 * view.scale,
      });
    }
    for (const marker of actionMarkers(model).values()) {
      if (!equalHex(marker.hex, cue.hex))
        obstacles.push({ ...project(marker.hex), radius: 28 * view.scale });
    }
    const key = JSON.stringify([target, view, obstacles, model.highContrast]);
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    const { start, tip } = placeTutorialArrow(
      target,
      32 * view.scale,
      32 * boardTilt(view.depth) * view.scale,
      view,
      obstacles,
      [],
      view.orientation,
    );
    const length = Math.hypot(tip.x - start.x, tip.y - start.y);
    const ux = (tip.x - start.x) / length;
    const uy = (tip.y - start.y) / length;
    // Stop the shaft at the triangle base so its round cap cannot blunt the tip.
    const base = { x: tip.x - ux * 10, y: tip.y - uy * 10 };
    const arrow = [
      tip.x,
      tip.y,
      base.x - uy * 5,
      base.y + ux * 5,
      base.x + uy * 5,
      base.y - ux * 5,
    ];
    this.connector
      .clear()
      .moveTo(start.x, start.y)
      .lineTo(base.x, base.y)
      .stroke({ color: dark, width: 7, cap: 'round' })
      .poly(arrow)
      .fill(dark)
      .stroke({ color: dark, width: 3, join: 'round' })
      .moveTo(start.x, start.y)
      .lineTo(base.x, base.y)
      .stroke({ color, width: 3, cap: 'round' })
      .poly(arrow)
      .fill(color);
  }
}
