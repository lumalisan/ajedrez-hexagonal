import { Container, Graphics, Text } from 'pixi.js';
import { hexToWorld } from '../hex';
import { COLORS, boardTilt, projectHex, type RenderModel } from './model';
import { hexPoints } from './shapes';

interface TutorialView {
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
  orientation: number;
  depth: number;
}

/** Retained cell frame plus a screen-sized label that remains upright as the board turns. */
export class PixiTutorialCue {
  readonly board = new Graphics({ label: 'tutorial-cell', eventMode: 'none' });
  readonly screen = new Container({ label: 'tutorial-callout', eventMode: 'none' });
  private readonly connector = new Graphics();
  private readonly background = new Graphics();
  private readonly text = new Text({
    text: '',
    style: {
      fontFamily: 'Segoe UI, sans-serif',
      fontSize: 13,
      fontWeight: '700',
      fill: COLORS.text,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: 220,
    },
    resolution: 3,
  });
  private contrast: boolean | null = null;
  private layoutKey = '';

  constructor() {
    this.text.anchor.set(0.5);
    this.screen.addChild(this.connector, this.background, this.text);
    this.board.visible = false;
    this.screen.visible = false;
  }

  update(model: RenderModel | null, view: TutorialView): void {
    const cue = model?.tutorialCue;
    this.board.visible = Boolean(cue);
    this.screen.visible = Boolean(cue);
    if (!cue || !model) return;

    const color = model.highContrast ? '#ffffff' : COLORS.text;
    const dark = model.highContrast ? '#000000' : COLORS.background;
    if (this.contrast !== model.highContrast) {
      this.contrast = model.highContrast;
      this.board
        .clear()
        .poly(hexPoints(29))
        .stroke({ color: dark, width: 8, join: 'round' })
        .poly(hexPoints(29))
        .stroke({ color, width: 3.4, join: 'round' })
        .poly(hexPoints(23.6))
        .stroke({ color, width: 1.8, join: 'round' });
      this.text.style.fill = color;
    }
    const world = hexToWorld(cue.hex);
    this.board.position.set(world.x, world.y);
    const projected = projectHex(cue.hex, view.orientation, view.depth);
    const target = {
      x: view.x + projected.x * view.scale,
      y: view.y + projected.y * view.scale,
    };
    // A panned-out target must not leave a label pointing to an unrelated visible cell.
    this.screen.visible =
      target.x >= 0 && target.x <= view.width && target.y >= 0 && target.y <= view.height;
    if (!this.screen.visible) return;

    const key = `${cue.label}:${target.x}:${target.y}:${view.scale}:${view.depth}:${view.width}:${view.height}:${model.highContrast}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    if (this.text.text !== cue.label) this.text.text = cue.label;
    const wrapWidth = Math.min(220, Math.max(40, view.width - 48));
    if (this.text.style.wordWrapWidth !== wrapWidth) this.text.style.wordWrapWidth = wrapWidth;
    const width = this.text.width + 22;
    const height = this.text.height + 12;
    const cellRadius = 29 * boardTilt(view.depth) * view.scale;
    const above = target.y - cellRadius - height - 22 >= 8;
    const side = above ? -1 : 1;
    const tipY = target.y + side * cellRadius;
    const centerX = Math.max(8 + width / 2, Math.min(view.width - 8 - width / 2, target.x));
    const centerY = tipY + side * (22 + height / 2);
    const startY = centerY - (side * height) / 2;
    this.background
      .clear()
      .roundRect(centerX - width / 2, centerY - height / 2, width, height, 6)
      .fill(dark)
      .stroke({ color, width: model.highContrast ? 2 : 1.5 });
    this.text.position.set(centerX, centerY);
    const dx = target.x - centerX;
    const dy = tipY - startY;
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    this.connector
      .clear()
      .moveTo(centerX, startY)
      .lineTo(target.x, tipY)
      .stroke({ color: dark, width: 6, cap: 'round' })
      .moveTo(centerX, startY)
      .lineTo(target.x, tipY)
      .stroke({ color, width: 2, cap: 'round' })
      .poly([
        target.x,
        tipY,
        target.x - ux * 8 - uy * 4,
        tipY - uy * 8 + ux * 4,
        target.x - ux * 8 + uy * 4,
        tipY - uy * 8 - ux * 4,
      ])
      .fill(color);
  }
}
