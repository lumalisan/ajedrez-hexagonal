import { Container, FillGradient, Graphics, type DestroyOptions } from 'pixi.js';
import type { Piece } from '../types';
import { createPieceGlyph, type PieceGlyph } from './pixi-piece-glyph';

export interface PixiPieceOptions {
  selected: boolean;
  highContrast: boolean;
  alpha: number;
  isStacked?: boolean;
  orientation: number;
  glyphRotation?: number;
  fortressMaxHp?: 1 | 2 | 3;
  /** Omit to keep the glyph completely still, including in instructional scenes. */
  idleTime?: number;
  depth: number;
}

const TAU = Math.PI * 2;
const CYAN = 0x36b9ff;
const AMBER = 0xffb547;
const TEXT = 0xf3ebdd;
const gradients = new Map<number, { gradient: FillGradient; users: number }>();

/** One retained token, positioned by the scene in projected board coordinates. */
export class PixiPiece extends Container {
  private readonly shadow = new Graphics({ label: 'piece-shadow' });
  private readonly airRing = new Graphics({ label: 'piece-air-ring' });
  private readonly tether = new Graphics({ label: 'piece-air-tether' });
  private readonly token = new Container({ label: 'piece-token' });
  private readonly glow = new Graphics({ label: 'piece-glow' });
  private readonly base = new Graphics({ label: 'piece-base' });
  private readonly rim = new Graphics({ label: 'piece-rim' });
  private readonly glyphMotion = new Container({ label: 'piece-glyph-motion' });
  private readonly marks = new Graphics({ label: 'piece-owner-health' });
  private glyph: PieceGlyph | null = null;
  private baseKey = '';
  private shadowKey = '';
  private airKey = '';
  private glyphKey = '';
  private markKey = '';
  private gradientRadius: number | null = null;
  private identity = '';
  private idleSeed = 0;

  constructor() {
    super({ label: 'piece', eventMode: 'none', interactiveChildren: false });
    this.addChild(this.shadow, this.airRing, this.tether, this.token);
    this.token.addChild(this.glow, this.base, this.rim, this.glyphMotion, this.marks);
  }

  update(piece: Piece, options: PixiPieceOptions): void {
    if (this.destroyed) return;
    const color = piece.owner === 0 ? CYAN : AMBER;
    const airborne = piece.type === 'airplane' || piece.type === 'drone';
    const radius = piece.type === 'fortress' ? 19 : 16.6;
    const lift = (airborne ? 27 : 4) * options.depth;
    this.alpha = options.alpha;
    this.token.y = -lift;

    if (this.identity !== piece.id) {
      this.identity = piece.id;
      this.label = `piece-${piece.id}`;
      this.idleSeed = idleSeed(piece.id);
    }

    const shadowKey = String(airborne);
    if (shadowKey !== this.shadowKey) {
      this.shadowKey = shadowKey;
      this.shadow
        .clear()
        .ellipse(0, 5, airborne ? 19 : 16, airborne ? 6.5 : 5)
        .fill({ color: 0x000000, alpha: 0.48 });
    }
    this.airRing.visible = this.tether.visible = airborne && options.depth > 0.01;
    const airKey = `${color}:${options.selected}:${Boolean(options.isStacked)}`;
    if (airborne && airKey !== this.airKey) {
      this.airKey = airKey;
      const stroke = {
        color,
        width: options.selected ? 3 : options.isStacked ? 2.6 : 1.7,
      };
      this.airRing.clear().ellipse(0, 5, 19, 6.5).stroke(stroke);
      this.tether.clear().moveTo(0, 0).lineTo(0, -1).stroke(stroke);
    }
    this.airRing.alpha = this.tether.alpha = options.isStacked ? 1 : 0.68;
    this.tether.y = -1;
    this.tether.scale.y = lift - 6;

    const baseKey = `${radius}:${color}:${options.selected}:${options.highContrast}`;
    if (baseKey !== this.baseKey) {
      this.baseKey = baseKey;
      this.drawBase(piece, options, radius, color);
    }

    const markKey = `${piece.type}:${piece.owner}:${piece.type === 'fortress' ? piece.hp : ''}:${options.fortressMaxHp ?? 2}`;
    if (markKey !== this.markKey) {
      this.markKey = markKey;
      this.drawMarks(piece, options.fortressMaxHp ?? 2, color);
    }

    const glyphKey = `${piece.type}:${piece.owner}:${options.highContrast}`;
    if (glyphKey !== this.glyphKey) {
      this.glyphKey = glyphKey;
      if (this.glyph) {
        this.glyph.container.removeFromParent();
        this.glyph.container.destroy({ children: true, context: true });
      }
      this.glyph = createPieceGlyph(piece, options.highContrast);
      this.glyphMotion.addChild(this.glyph.container);
    }
    const phase =
      options.idleTime === undefined
        ? null
        : (options.idleTime / (4800 + (this.idleSeed % 1800))) * TAU +
          ((this.idleSeed % 997) / 997) * TAU;
    const directionalAngle =
      piece.type === 'soldier' || piece.type === 'airplane'
        ? -Math.PI / 2 + piece.facing * (Math.PI / 3)
        : piece.type === 'medium'
          ? -Math.PI / 2 + piece.cannon * (Math.PI / 3)
          : piece.type === 'capturer' || piece.type === 'fast' || piece.type === 'long'
            ? piece.owner === 0
              ? Math.PI / 2
              : -Math.PI / 2
            : 0;
    this.glyph!.container.rotation =
      options.orientation + (options.glyphRotation ?? 0) + directionalAngle;
    this.glyph!.update(piece, phase);

    this.glyphMotion.position.set(0, 0);
    this.glyphMotion.rotation = 0;
    this.glyphMotion.scale.set(1);
    if (phase !== null) {
      if (piece.type === 'drone') {
        this.glyphMotion.position.set(Math.sin(phase) * 1.8, Math.sin(phase * 1.4) * 0.85);
        this.glyphMotion.rotation = Math.sin(phase) * 0.035;
      } else if (piece.type === 'airplane') {
        this.glyphMotion.y = Math.sin(phase) * 0.65;
        this.glyphMotion.rotation = Math.sin(phase * 0.8) * 0.035;
      } else if (piece.type === 'soldier') {
        this.glyphMotion.scale.set(1 + Math.sin(phase * 2) * 0.045);
      }
    }
  }

  private drawBase(piece: Piece, options: PixiPieceOptions, radius: number, color: number): void {
    this.base.clear();
    if (this.gradientRadius !== radius) {
      if (this.gradientRadius !== null) releaseGradient(this.gradientRadius);
      this.gradientRadius = radius;
      acquireGradient(radius);
    }
    this.glow.clear();
    // Soft concentric strokes avoid a filter/render texture for every small token.
    for (const [width, alpha] of options.selected
      ? [
          [14, 0.025],
          [9, 0.05],
          [4, 0.12],
        ]
      : [
          [7, 0.035],
          [3, 0.1],
        ]) {
      this.glow.circle(0, 1, radius).stroke({ color, width, alpha });
    }
    this.base
      .circle(0, 4, radius)
      .fill(0x040d12)
      .stroke({ color, alpha: 0.46, width: 1.5 })
      .circle(0, 0, radius)
      .fill(gradients.get(radius)!.gradient);

    this.rim.clear();
    const width = options.selected ? 2.8 : options.highContrast ? 2.2 : 1.65;
    if (piece.owner === 1) dashedCircle(this.rim, radius, color, width);
    else this.rim.circle(0, 0, radius).stroke({ color, width });
    this.rim
      .beginPath()
      .arc(0, 0, radius - 3, Math.PI * 1.08, Math.PI * 1.92)
      .stroke({ color: TEXT, alpha: 0.34, width: 0.65 });
    for (let index = 0; index < 3; index += 1) {
      const angle = -Math.PI / 2 + (index * TAU) / 3 + (piece.owner === 1 ? Math.PI / 3 : 0);
      this.rim
        .moveTo(Math.cos(angle) * (radius - 1.2), Math.sin(angle) * (radius - 1.2))
        .lineTo(Math.cos(angle) * (radius - 4.1), Math.sin(angle) * (radius - 4.1))
        .stroke({ color, alpha: 0.62, width: 1.25 });
    }
    if (options.selected) this.rim.circle(0, 0, 19.8).stroke({ color: TEXT, alpha: 0.5, width: 1 });
  }

  private drawMarks(piece: Piece, maximum: 1 | 2 | 3, color: number): void {
    this.marks.clear();
    if (piece.type === 'fortress') {
      const totalWidth = maximum * 6 + (maximum - 1) * 2;
      for (let index = 0; index < maximum; index += 1) {
        this.marks
          .rect(-totalWidth / 2 + index * 8, 12, 6, 2.5)
          .fill({ color, alpha: index < piece.hp ? 1 : 0.18 });
      }
      return;
    }
    if (piece.owner === 0) this.marks.circle(0, 12, 1.6);
    else this.marks.poly([0, 9.2373, 2.2627, 11.5, 0, 13.7627, -2.2627, 11.5]);
    if (piece.type === 'airplane') this.marks.stroke({ color: 0x061118, width: 1.1 });
    this.marks.fill(color);
  }

  override destroy(options?: DestroyOptions): void {
    if (this.destroyed) return;
    super.destroy({
      ...(typeof options === 'object' ? options : {}),
      children: true,
      context: true,
      // Gradients are shared by token radius and released after the last token.
      texture: false,
      textureSource: false,
    });
    if (this.gradientRadius !== null) releaseGradient(this.gradientRadius);
    this.gradientRadius = null;
    this.glyph = null;
  }
}

function dashedCircle(graphics: Graphics, radius: number, color: number, width: number): void {
  const circumference = radius * TAU;
  for (let distance = 0; distance < circumference; distance += 6.4) {
    graphics
      .beginPath()
      .arc(0, 0, radius, distance / radius, Math.min(distance + 4, circumference) / radius)
      .stroke({ color, width });
  }
}

function idleSeed(id: string): number {
  let seed = 0;
  for (let index = 0; index < id.length; index += 1)
    seed = (Math.imul(seed, 31) + id.charCodeAt(index)) >>> 0;
  return seed;
}

function acquireGradient(radius: number): void {
  const existing = gradients.get(radius);
  if (existing) {
    existing.users += 1;
    return;
  }
  gradients.set(radius, {
    users: 1,
    gradient: new FillGradient({
      type: 'radial',
      center: { x: -5, y: -6 },
      innerRadius: 1,
      outerCenter: { x: 0, y: 0 },
      outerRadius: radius + 2,
      textureSpace: 'global',
      textureSize: 64,
      colorStops: [
        { offset: 0, color: 0x1c3943 },
        { offset: 0.48, color: 0x102831 },
        { offset: 1, color: 0x061118 },
      ],
    }),
  });
}

function releaseGradient(radius: number): void {
  const entry = gradients.get(radius);
  if (!entry) return;
  entry.users -= 1;
  if (entry.users === 0) {
    entry.gradient.destroy();
    gradients.delete(radius);
  }
}
